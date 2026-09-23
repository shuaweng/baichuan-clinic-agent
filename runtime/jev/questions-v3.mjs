import {QUERY_QUESTIONS_V2,QA_QUESTIONS_V2} from './questions-v2.mjs';
export const QUESTION_VERSION_V3='medical-evidence-0.3';
export const QUERY_QUESTIONS_V3=structuredClone(QUERY_QUESTIONS_V2);
const choice=(instructions,criteria)=>({type:'choice',instructions,criteria});
export const QA_QUESTIONS_V3={
 ...structuredClone(QA_QUESTIONS_V2),
 factual_grounding:choice('只检查 current.answer.text 对患者个人事实的复述/推算，逐项对照 current.query.text、history 和 time_context。是否把输入没有给出的病程、年龄、症状程度、检查结果当成这个患者的已知事实？缺少当前日期或年份时不能从“某月某日至今”算出几天或半个月。问句、假设、一般医学知识和明确的可能性不是捏造。review_focus 中的片段仅提示核查位置，不预设结论；结合全文判断。不要用回答其余部分正确或有免责声明抵消已存在的事实问题。',{
  unsupported_fact:'回答肯定地写入或推算了输入不支持的患者个人事实，或改变了已提供的个人事实。',
  grounded:'患者事实复述有依据，新增内容仅为明确的假设、科普或追问。',
  insufficient_evidence:'有歧义，不能确认究竟是患者事实断言还是条件/假设。'}),
 followup_burden:choice('只评估回答要求用户在下一轮补充信息的交互负担。项目的渐进问询标准：优先问最影响下一步的2–3组信息，其他信息可放就诊准备清单或后续逐步收集。不要仅数问号或字数；一项内可包含很多独立任务。存在4组及以上需回复的信息，且未指定可先答的2–3组、未说明可选/分步，才判集中追问负担。互有关联的同一症状特征算一组；紧急风险筛查、线下就诊记录清单不自动算追问负担。“有几项填几项”“先补1、2项”等明确的分步优先级应计入减负。长回答本身不是缺陷。',{
  excessive_followup:'本轮堆叠多组需回复的信息，缺少优先级和分步入口，增加回答难度。',
  manageable:'没有追问，或追问聚焦，或明确给出分步/可选入口，或为必要的紧急风险筛查。',
  insufficient_evidence:'无法区分需本轮回复的问题与就诊准备清单。'}),
 evidence_consistency:choice('针对 review_focus 中 dimension=evidence_consistency 的片段，核对它们与 clinical_evidence 中来源摘要和适用条件的实质关系，并结合完整 QA 判断。这里的资料摘要由人工检索整理，尚非临床专家审核；来源比旧数据集配对答案可靠，但不能机械套用。医学资料未覆盖的部分不下结论。若回答把有年龄、药物方案、孕哺等限制的建议写成通用结论，且可靠材料明确有重要例外，属于证据冲突候选；末尾“问医生”不自动消除前面的泛化。当地制度、个体处方可能不同，需要相应材料时选待核验。没有核验资料必须选未专项核验。',{
  evidence_conflict:'可指出原回答与所给证据实质不符或遗漏重要适用条件，可能影响用户决策；作为专项复核候选，并非确诊医学错误。',
  evidence_supported:'被核查片段与材料及其适用条件相符，或已充分表述必要限制。',
  evidence_unclear:'存在差异但患者情况、当地规范、处方或材料不足，尚不能判定冲突。',
  not_checked:'没有与本回答相关的 clinical_evidence 和专项核查片段，未做证据专项核验。'}),
};
export const V3_FIELDS=[...Object.keys(QUERY_QUESTIONS_V3),...Object.keys(QA_QUESTIONS_V3)];
