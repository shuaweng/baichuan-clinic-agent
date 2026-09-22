import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, runEvaluation, formatEvaluationError } from './evaluate.mjs';

test('403 verification error gives the actual remedy without echoing provider payloads', () => {
  const error = { name: 'GatewayInternalServerError', statusCode: 403,
    cause: { message: '{"error":{"type":"customer_verification_required","message":"private-token private-user-data"}}' } };
  const message = formatEvaluationError(error);
  assert.match(message, /绑定有效信用卡/);
  assert.match(message, /无需重新创建/);
  assert.equal(message.includes('private-'), false);
  assert.doesNotMatch(formatEvaluationError({statusCode:403,message:'other forbidden reason'}), /绑定有效信用卡/);
});

const sample = () => ({
  product_contract: { service_scope: ['妇幼及产品支持'], capability_snapshot: { text: 'configured' } },
  current: { turn_id: 1, query: { text: '你是谁？', reasoning: 'must not leak' }, answer: { text: '妇幼健康咨询助手。' }, completion: { kind: 'completed' } },
  execution: { observation_status: 'complete_for_closed_turn', tool_calls: [], tool_results: [] },
  history: [], source_file: '/private/path', gold_label: 'must not leak',
});

test('query view excludes answer, execution and private trace metadata', () => {
  const request = buildRequest(sample(), 'query');
  assert.equal(request.state.current.answer, undefined);
  assert.equal(request.state.execution, undefined);
  assert.equal(request.state.source_file, undefined);
  assert.equal(JSON.stringify(request).includes('must not leak'), false);
  assert.equal(request.questions.explicit_dissatisfaction.type, 'boolean');
});

test('unfinished QA and internal fields in history fail before network', () => {
  const input = sample();
  input.current.completion.kind = 'cancelled';
  assert.throws(() => buildRequest(input), /已完成/);
  input.current.completion.kind = 'completed';
  input.history = [{ reasoning: 'private reasoning' }];
  assert.throws(() => buildRequest(input), /内部字段/);
});

test('installed AI SDK accepts our questions and returns typed answers without a network call', async () => {
  for (const mode of ['query', 'qa']) {
    const request = buildRequest(sample(), mode);
    const model = {
      specificationVersion: 'v4', provider: 'local-test', modelId: 'test-only',
      supportedQuestionTypes: ['choice', 'score', 'boolean'],
      async doEvaluate({ questions }) {
        const answers = Object.fromEntries(Object.entries(questions).map(([id, q]) => {
          if (q.type === 'boolean') return [id, { type: 'boolean', probability: 0.25 }];
          const keys = Object.keys(q.criteria);
          return [id, { type: 'choice', choice: keys[0], probabilities: Object.fromEntries(keys.map((key, i) => [key, i === 0 ? 1 : 0])) }];
        }));
        return { answers, warnings: [], usage: { inputTokens: 10, outputTokens: 2 } };
      },
    };
    const result = await runEvaluation(request, model);
    assert.equal(result.model_reported, 'test-only');
    assert.equal(result.usage.totalTokens, 12);
    assert.deepEqual(Object.keys(result.answers), Object.keys(request.questions));
    assert.equal(result.response, undefined);
    if (mode === 'query') assert.equal(result.answers.explicit_dissatisfaction.probability, 0.25);
  }
});
