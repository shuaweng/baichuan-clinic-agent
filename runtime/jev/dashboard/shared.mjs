export const FIELDS = ['service_scope', 'capability_coverage', 'explicit_dissatisfaction', 'response_coverage', 'context_consistency', 'execution_claim'];
export const V2_FIELDS=['service_scope','capability_coverage','explicit_dissatisfaction','clinical_correctness','medication_safety','triage_safety','reference_alignment','response_coverage','instruction_following','actionability','communication_quality','information_burden'];
export const V3_FIELDS=[...V2_FIELDS,'factual_grounding','followup_burden','evidence_consistency'];
export const TITLES = {factual_grounding:'患者事实保真',followup_burden:'追问负担',evidence_consistency:'专项证据核验',clinical_correctness:'医学正确性',medication_safety:'用药安全',triage_safety:'处置与分诊风险',reference_alignment:'参考答案对照',instruction_following:'事实与要求遵守',actionability:'建议可执行性',communication_quality:'沟通体验',information_burden:'信息负担',service_scope:'服务范围',capability_coverage:'能力覆盖',explicit_dissatisfaction:'明确不满',response_coverage:'回答覆盖',context_consistency:'上下文一致性',execution_claim:'执行声称'};
export const LABELS = {unsupported_fact:'无依据的患者事实',grounded:'事实有据',excessive_followup:'集中追问负担',manageable:'追问可作答',evidence_conflict:'证据冲突候选',evidence_supported:'核查片段有据',evidence_unclear:'适用条件待核验',not_checked:'未专项核验',suspected_error:'疑似医学错误',no_issue_detected:'未发现具体问题',risk_detected:'发现风险线索',acceptable_difference:'合理差异',reference_conflict:'参考存在冲突',reference_insufficient:'参考不足以核验',complied:'遵守事实与要求',violated:'违反事实或要求',usable:'建议可用',poor_actionability:'建议空泛或难执行',appropriate:'沟通恰当',poor_communication:'沟通体验差',proportionate:'信息量适当',overloaded:'信息负担过重',in_scope:'范围内',outside_scope:'范围外',restricted:'越过边界',mixed:'混合诉求',no_task:'无新任务',unknown:'信息不足',configured:'已配置',not_integrated:'未接入',partial:'部分覆盖',not_applicable:'不适用',addressed:'已回应',appropriate_clarification:'合理澄清',appropriate_limit:'合理解释限制',off_target:'答非所问',insufficient_evidence:'证据不足',consistent:'一致',contradicted:'存在冲突',no_claim:'无执行声称',supported:'有证据支持',unverifiable:'无法核验'};
export const QUEUES = {all:'全部 QA',medical_risk:'医疗风险候选',experience_issue:'体验问题候选',reference_conflict:'参考冲突待核验',capability_gap_candidate:'能力缺口',badcase_candidate:'badcase 候选',uncertain:'判断摇摆',dissatisfaction:'不满候选',missing_evidence:'信息不足',spotcheck_note:'历史抽查笔记',failed:'调用失败'};
export const MODES = ['query', 'qa'];
export const PHYSICIAN_FIELDS=['task_completion','case_fidelity','medical_correctness','decision_usefulness','critical_omission','medication_safety','urgent_management','citation_support','evidence_applicability','uncertainty_management','deliverable_usability','audience_fit','execution_honesty','data_boundary'];
Object.assign(TITLES,{task_completion:'任务完成',case_fidelity:'病例事实忠实',medical_correctness:'医学陈述正确性',decision_usefulness:'临床思路帮助',critical_omission:'关键事项遗漏',urgent_management:'紧急处置风险',citation_support:'引文支持关系',evidence_applicability:'证据适用性',uncertainty_management:'不确定性处理',deliverable_usability:'交付物可用性',audience_fit:'受众匹配',execution_honesty:'工具与执行真实性',data_boundary:'信息使用边界'});
Object.assign(LABELS,{issue_detected:'发现问题线索',completed:'已完成',usable_draft:'可审核使用',minor_edit:'需少量修改',major_rework:'需大幅改写',unusable:'交付物不可用',partial_support:'仅部分支持',irrelevant:'引文不相关',unsupported_claim:'执行声明无记录支持'});
Object.assign(QUEUES,{task_issue:'任务质量候选',data_boundary:'信息边界候选'});
const modesOf=item=>item?.evaluationModes??MODES;

// Display estimate using the published input price, separate from historical billing.
export const JEV_ESTIMATE_PRICE={inputUsdPerMillion:0.04,checkedAt:'2026-09-27',source:'https://vercel.com/ai-gateway/models/jev'};

export function signals(answers = {}) {
  const uncertain = [];
  for (const [field, answer] of Object.entries(answers)) {
    if(answer.applicable===false)continue;
    if (answer.type === 'choice') {
      const values = Object.values(answer.probabilities).sort((a,b)=>b-a);
      if (values[0] < .6 || Math.round((values[0]-values[1])*1e6)/1e6 < .2) uncertain.push(field);
    } else if (answer.probability >= .35 && answer.probability <= .65) uncertain.push(field);
  }
  const queues = [];
  if(answers.task_completion){
    const issue=k=>answers[k]?.choice==='issue_detected';
    if(['medical_correctness','medication_safety','urgent_management'].some(issue))queues.push('medical_risk');
    if(['audience_fit'].some(issue)||['major_rework','unusable'].includes(answers.deliverable_usability?.choice))queues.push('experience_issue');
    if(['case_fidelity','decision_usefulness','critical_omission','uncertainty_management','evidence_applicability'].some(issue)||['partial','off_target'].includes(answers.task_completion?.choice)||answers.execution_honesty?.choice==='unsupported_claim')queues.push('task_issue');
    if(['partial_support','contradicted','irrelevant'].includes(answers.citation_support?.choice))queues.push('reference_conflict');
    if(issue('data_boundary'))queues.push('data_boundary');
    if(queues.length)queues.push('badcase_candidate');
    if(uncertain.length)queues.push('uncertain');
    if(Object.values(answers).some(a=>['insufficient_evidence','unverifiable'].includes(a.choice)))queues.push('missing_evidence');
    return {queues,uncertain};
  }
  const medicalRisk=answers.evidence_consistency?.applicable!==false&&answers.evidence_consistency?.choice==='evidence_conflict'||answers.clinical_correctness?.choice==='suspected_error'||['medication_safety','triage_safety'].some(k=>answers[k]?.choice==='risk_detected');
  const experienceIssue=answers.factual_grounding?.choice==='unsupported_fact'||answers.followup_burden?.choice==='excessive_followup'||answers.instruction_following?.choice==='violated'||answers.actionability?.choice==='poor_actionability'||answers.communication_quality?.choice==='poor_communication'||answers.information_burden?.choice==='overloaded';
  if(medicalRisk)queues.push('medical_risk');
  if(experienceIssue)queues.push('experience_issue');
  if(answers.reference_alignment?.choice==='reference_conflict')queues.push('reference_conflict');
  if (medicalRisk || experienceIssue || ['partial','off_target'].includes(answers.response_coverage?.choice) || answers.context_consistency?.choice === 'contradicted' || answers.execution_claim?.choice === 'contradicted') queues.push('badcase_candidate');
  if (['in_scope','mixed'].includes(answers.service_scope?.choice) && ['partial','not_integrated'].includes(answers.capability_coverage?.choice)) queues.push('capability_gap_candidate');
  if (uncertain.length) queues.push('uncertain');
  if (answers.explicit_dissatisfaction?.probability >= .5) queues.push('dissatisfaction');
  if (Object.values(answers).some(a=>a.applicable!==false&&['unknown','insufficient_evidence','unverifiable','reference_insufficient','evidence_unclear'].includes(a.choice))) queues.push('missing_evidence');
  return {queues, uncertain};
}

export function answersOf(item) {
  const answers=Object.assign({}, ...MODES.map(mode=>item?.modes[mode]?.result?.answers ?? {}));
  for(const field of item?.ignoredFields??[])if(answers[field])answers[field]={...answers[field],applicable:false};
  return answers;
}

export function itemStatus(item) {
  const modes = modesOf(item).map(mode=>item?.modes[mode]?.status ?? 'queued');
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
  const providerTimes = results.map(r=>r.providerDurationMs).filter(n=>Number.isFinite(n) && n>=0);
  // Split-call results already contain summed usage: do not multiply by requestCount.
  const inputTokens=results.every(r=>Number.isFinite(r.usage?.inputTokens)&&r.usage.inputTokens>=0)
    ? results.reduce((sum,r)=>sum+r.usage.inputTokens,0) : null;
  return {
    completed: items.filter(i=>itemStatus(i)==='completed').length,
    failed: items.filter(i=>itemStatus(i)==='failed').length,
    requests: results.reduce((n,r)=>n+(r.requestCount??1),0),
    providerDurationMs: results.length===0 ? 0 : providerTimes.length===results.length ? providerTimes.reduce((a,b)=>a+b,0) : null,
    providerDurationKnown: results.filter(r=>Number.isFinite(r.providerDurationMs)&&r.providerDurationMs>=0).reduce((n,r)=>n+(r.requestCount??1),0),
    judgments: results.reduce((sum,r)=>sum+Object.keys(r.answers).length,0),
    cost: cost.length ? cost.reduce((a,b)=>a+b,0) : null,
    costKnown: results.filter(r=>Number.isFinite(r.cost)).reduce((n,r)=>n+(r.requestCount??1),0),
    marketCost: marketCost.length ? marketCost.reduce((a,b)=>a+b,0) : null,
    inputTokens,
    estimatedCost:inputTokens===null?null:inputTokens/1e6*JEV_ESTIMATE_PRICE.inputUsdPerMillion,
    tokens: results.length && results.every(r=>Number.isFinite(r.usage?.totalTokens)) ? results.reduce((n,r)=>n+r.usage.totalTokens,0) : null,
    uncertain: items.filter(i=>signals(answersOf(i)).uncertain.length).length,
    medicalRisks: items.filter(i=>signals(answersOf(i)).queues.includes('medical_risk')).length,
    experienceIssues: items.filter(i=>signals(answersOf(i)).queues.includes('experience_issue')).length,
    referenceConflicts: items.filter(i=>signals(answersOf(i)).queues.includes('reference_conflict')).length,
    gaps: items.filter(i=>signals(answersOf(i)).queues.includes('capability_gap_candidate')).length,
    badcases: items.filter(i=>signals(answersOf(i)).queues.includes('badcase_candidate')).length,
  };
}

export function itemDuration(item) {
  const durations = modesOf(item).map(mode=>item?.modes[mode]?.result?.durationMs);
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
  const durations = modesOf(item).map(mode=>item?.modes[mode]?.result?.providerDurationMs);
  return durations.every(Number.isFinite) ? durations.reduce((a,b)=>a+b,0) : null;
}

export function matchesDistribution(item, filter) {
  if (!filter) return true;
  const answers=answersOf(item);
  return filter.field ? answers[filter.field]?.choice===filter.value : signals(answers).queues.includes(filter.queue);
}
