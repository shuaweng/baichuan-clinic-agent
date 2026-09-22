export const FIELDS = ['service_scope', 'capability_coverage', 'explicit_dissatisfaction', 'response_coverage', 'context_consistency', 'execution_claim'];
export const TITLES = {service_scope:'服务范围',capability_coverage:'能力覆盖',explicit_dissatisfaction:'明确不满',response_coverage:'回答覆盖',context_consistency:'上下文一致性',execution_claim:'执行声称'};
export const LABELS = {in_scope:'范围内',outside_scope:'范围外',restricted:'越过边界',mixed:'混合诉求',no_task:'无新任务',unknown:'信息不足',configured:'已配置',not_integrated:'未接入',partial:'部分覆盖',not_applicable:'不适用',addressed:'已回应',appropriate_clarification:'合理澄清',appropriate_limit:'合理解释限制',off_target:'答非所问',insufficient_evidence:'证据不足',consistent:'一致',contradicted:'存在冲突',no_claim:'无执行声称',supported:'有证据支持',unverifiable:'无法核验'};
export const QUEUES = {all:'全部 QA',capability_gap_candidate:'能力缺口',badcase_candidate:'badcase 候选',uncertain:'判断摇摆',dissatisfaction:'不满候选',missing_evidence:'信息不足',spotcheck_note:'历史抽查笔记',failed:'调用失败'};
export const MODES = ['query', 'qa'];

export function signals(answers = {}) {
  const uncertain = [];
  for (const [field, answer] of Object.entries(answers)) {
    if (answer.type === 'choice') {
      const values = Object.values(answer.probabilities).sort((a,b)=>b-a);
      if (values[0] < .6 || Math.round((values[0]-values[1])*1e6)/1e6 < .2) uncertain.push(field);
    } else if (answer.probability >= .35 && answer.probability <= .65) uncertain.push(field);
  }
  const queues = [];
  if (['partial','off_target'].includes(answers.response_coverage?.choice) || answers.context_consistency?.choice === 'contradicted' || answers.execution_claim?.choice === 'contradicted') queues.push('badcase_candidate');
  if (['in_scope','mixed'].includes(answers.service_scope?.choice) && ['partial','not_integrated'].includes(answers.capability_coverage?.choice)) queues.push('capability_gap_candidate');
  if (uncertain.length) queues.push('uncertain');
  if (answers.explicit_dissatisfaction?.probability >= .5) queues.push('dissatisfaction');
  if (Object.values(answers).some(a=>['unknown','insufficient_evidence','unverifiable'].includes(a.choice))) queues.push('missing_evidence');
  return {queues, uncertain};
}

export function answersOf(item) {
  return Object.assign({}, ...MODES.map(mode=>item?.modes[mode]?.result?.answers ?? {}));
}

export function itemStatus(item) {
  const modes = MODES.map(mode=>item?.modes[mode]?.status ?? 'queued');
  if (modes.every(s=>s==='completed')) return 'completed';
  if (modes.includes('running') || modes.includes('retrying')) return 'running';
  if (modes.includes('failed')) return 'failed';
  if (modes.includes('completed')) return 'partial';
  return 'queued';
}

export function metrics(items = []) {
  const results = items.flatMap(item=>MODES.map(mode=>item.modes[mode]?.result).filter(Boolean));
  const cost = results.map(r=>r.cost).filter(n=>typeof n==='number' && Number.isFinite(n));
  const marketCost = results.map(r=>r.marketCost).filter(n=>typeof n==='number' && Number.isFinite(n));
  return {
    completed: items.filter(i=>itemStatus(i)==='completed').length,
    failed: items.filter(i=>itemStatus(i)==='failed').length,
    requests: results.length,
    judgments: results.reduce((sum,r)=>sum+Object.keys(r.answers).length,0),
    cost: cost.length ? cost.reduce((a,b)=>a+b,0) : null,
    costKnown: cost.length,
    marketCost: marketCost.length ? marketCost.reduce((a,b)=>a+b,0) : null,
    tokens: results.length && results.every(r=>Number.isFinite(r.usage?.totalTokens)) ? results.reduce((n,r)=>n+r.usage.totalTokens,0) : null,
    uncertain: items.filter(i=>signals(answersOf(i)).uncertain.length).length,
    gaps: items.filter(i=>signals(answersOf(i)).queues.includes('capability_gap_candidate')).length,
    badcases: items.filter(i=>signals(answersOf(i)).queues.includes('badcase_candidate')).length,
  };
}

export function itemDuration(item) {
  const durations = MODES.map(mode=>item?.modes[mode]?.result?.durationMs);
  return durations.every(Number.isFinite) ? durations.reduce((a,b)=>a+b,0) : null;
}

// Gateway provider-attempt timing is not client latency or pure inference time.
export function providerDuration(gateway) {
  const attempts = gateway?.routing?.modelAttempts?.flatMap(model=>model.providerAttempts??[]) ?? [];
  const succeeded = attempts.filter(attempt=>attempt.success);
  if (!succeeded.length || succeeded.some(a=>!Number.isFinite(a.startTime)||!Number.isFinite(a.endTime)||a.endTime<a.startTime)) return null;
  return succeeded.reduce((sum,a)=>sum+a.endTime-a.startTime,0);
}

export function itemProviderDuration(item) {
  const durations = MODES.map(mode=>item?.modes[mode]?.result?.providerDurationMs);
  return durations.every(Number.isFinite) ? durations.reduce((a,b)=>a+b,0) : null;
}
