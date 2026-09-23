import { experimental_evaluate as evaluate } from 'ai';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { queryQuestions, qaQuestions, QUESTION_VERSION } from './questions.mjs';

import {QUERY_QUESTIONS_V3,QA_QUESTIONS_V3,QUESTION_VERSION_V3} from './questions-v3.mjs';
import {QUERY_QUESTIONS_V2,QA_QUESTIONS_V2,QUESTION_VERSION_V2} from './questions-v2.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MODEL = 'typesafe-ai/jev';
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, structuredClone(value[k])]));

export function formatEvaluationError(error) {
  // Interpret known provider errors without exposing raw bodies or request data.
  const status = error?.statusCode ?? error?.cause?.statusCode;
  const detail = [error?.message, error?.cause?.message, error?.cause?.responseBody].filter(v => typeof v === 'string').join('\n');
  if (status === 403 && /customer_verification_required|requires a valid credit card on file/i.test(detail)) {
    return '评估失败（403 / customer_verification_required）：Vercel 要求此 API Key 所属团队绑定有效信用卡后，才能使用 AI Gateway 及免费额度。无需重新创建 Key。请在 Vercel AI Gateway 控制台完成验证后重试。';
  }
  if (status === 401) return '评估失败（401）：网关未接受当前凭据。请核对 AI_GATEWAY_API_KEY 是否为有效的 Gateway Key，以及终端环境变量是否覆盖 .env.local。';
  if (status === 403) return '评估失败（403）：网关拒绝访问。请检查该 Key 所属团队的验证状态、权限及模型访问限制。未自动重试。';
  if (error?.name === 'Error' && !error.cause && status === undefined) return error.message;
  return `评估失败（${status ?? error?.name ?? 'unknown'}）；检查网关凭据、额度或输入格式。未自动重试。`;
}

// Accept a prepared, reviewed state, never a raw DSH session or credentials file.
export function buildRequest(input, mode = 'qa') {
  if (!['query', 'qa'].includes(mode)) throw new Error('mode 必须是 query 或 qa');
  if (!input?.product_contract?.service_scope || !input?.product_contract?.capability_snapshot) {
    throw new Error('缺少本轮产品范围或能力快照；不能用模拟能力表自动补齐。');
  }
  if (!input.current?.query?.text?.trim()) throw new Error('缺少 current.query.text');
  if (mode === 'qa' && (!input.current?.answer?.text?.trim() || input.current?.completion?.kind !== 'completed')) {
    throw new Error('QA 评估需要已完成轮次和非空 current.answer.text');
  }
  const v3=input.evaluation_profile==='medical-evidence-v3';
  const v2=v3||input.evaluation_profile==='medical-reference-v2';
  if(v2&&!input.reference_material?.answer?.trim())throw new Error('参考评估缺少数据集配对答案');
  const state = pick(input, ['product_contract', 'history', 'context_selection', 'relevant_facts', 'attachments', 'time_context', 'evidence_limitations']);
  state.current = {
    turn_id: input.current.turn_id,
    query: pick(input.current.query, ['evidence_id', 'text']),
  };
  if (mode === 'qa') {
    state.current.answer = pick(input.current.answer, ['evidence_id', 'text']);
    state.current.completion = pick(input.current.completion, ['kind']);
    if(v2)state.reference_material=structuredClone(input.reference_material);
    if(v3)Object.assign(state,pick(input,['clinical_evidence','review_focus']));
    state.execution = pick(input.execution, ['observation_status', 'tool_calls', 'tool_results', 'evidence_cutoff']);
  }
  // These are explicit data-contract checks, not a general PII redactor.
  const forbidden = new Set(['reasoning', 'reasoning_content', 'api_key', 'apiKey', 'authorization', 'cookie', 'source_file', 'gold_label']);
  function inspect(value) {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error('输入含内部字段，请先完成 Session 裁剪再评估。');
      inspect(child);
    }
  }
  inspect(state);
  return { model: MODEL, state, questions: structuredClone(v3 ? (mode==='query'?QUERY_QUESTIONS_V3:QA_QUESTIONS_V3) : v2 ? (mode==='query'?QUERY_QUESTIONS_V2:QA_QUESTIONS_V2) : (mode === 'query' ? queryQuestions : qaQuestions)) };
}

export async function runEvaluation(request, model = request.model) {
  const result = await evaluate({ ...request, model, maxRetries: 0, abortSignal: AbortSignal.timeout(60_000) });
  const gateway = result.providerMetadata?.gateway;
  return {
    status: 'evaluated',
    question_version: request.state.product_contract?.evaluation_profile==='medical-evidence-v3' ? QUESTION_VERSION_V3 : request.questions.clinical_correctness || request.state.product_contract?.evaluation_profile==='medical-reference-v2' ? QUESTION_VERSION_V2 : QUESTION_VERSION,
    model_requested: request.model,
    model_reported: result.response.modelId,
    evaluated_at: result.response.timestamp.toISOString(),
    answers: result.answers,
    usage: result.usage,
    rounding: result.rounding,
    gateway: pick(gateway, ['generationId', 'cost', 'marketCost', 'gatewayCost', 'routing']),
    input_sha256: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string', default: path.join(ROOT, '.local/jev-preview/turn-1.state.json') },
    mode: { type: 'string', default: 'qa' },
    'dry-run': { type: 'boolean', default: false },
  } });
  const request = buildRequest(JSON.parse(await readFile(path.resolve(values.input), 'utf8')), values.mode);
  const outDir = path.join(ROOT, '.local/jev-results');
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const id = `${Date.now()}-${values.mode}`;
  if (values['dry-run']) {
    const destination = path.join(outDir, `${id}.request.json`);
    await writeFile(destination, JSON.stringify(request, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(`仅预览，未发送请求。待发送输入：${destination}`);
    return;
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) throw new Error('请在项目 .env.local 中设置 AI_GATEWAY_API_KEY，或在当前终端导出该环境变量。');
  const result = await runEvaluation(request);
  const destination = path.join(outDir, `${id}.result.json`);
  await writeFile(destination, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`评估结果：${destination}`);
  console.log(JSON.stringify(result.answers, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(formatEvaluationError(error));
    process.exitCode = 1;
  });
}
