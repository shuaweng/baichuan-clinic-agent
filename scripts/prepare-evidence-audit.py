"""Attach reviewed source summaries and exact answer spans; never change the Q or DSH A."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
data=root/'data/chinese-medical-50'
local=root/'.local/chinese-medical-50-20260923'
rows=[json.loads(s) for s in (data/'jev-labels.jsonl').read_text().splitlines()]
sources={
 'sps-lactation':dict(title='NHS SPS：药物流产与哺乳（2024-02-20 更新）',url='https://sps.nhs.uk/articles/medically-terminating-a-pregnancy-during-breastfeeding/',summary='短期使用米非司酮和米索前列醇终止妊娠时，通常可以继续哺乳。乳汁中水平很低。',applicability='针对足月、健康婴儿和短期用药；早产、患病婴儿、合并其他药物或特殊方案需个体化评估。不能据此代替当地药品说明书或个人处方决定。'),
 'asrm-timing':dict(title='ASRM：不孕评估委员会意见（2021）',url='https://www.asrm.org/practice-guidance/practice-committee-documents/fertility-evaluation-of-infertile-women-a-committee-opinion-2021/',summary='无其他紧迫因素时，女性不足35岁通常未避孕12个月评估；35岁及以上为6个月；超过40岁可能应更早评估。已知相关疾病等情况不应等待固定时限。',applicability='用于一般不孕评估时机；患者年龄和病史未知时不能无条件套用单一时限。不是中国收费或转诊政策。'),
 'asrm-biopsy':dict(title='ASRM：内膜活检在不孕评估中的局限（2021）',url='https://www.asrm.org/practice-guidance/practice-committee-documents/fertility-evaluation-of-infertile-women-a-committee-opinion-2021/',summary='内膜组织学定期法曾用于推断排卵，但准确度和精度不足，不能有效区分生育与不孕人群；不推荐将内膜活检用于常规不孕评估。',applicability='仅针对常规排卵/不孕评估，不否定异常出血、内膜病变等其他适应证；不能据此否定原接诊医生的具体决定。'),
 'nice-feeding':dict(title='NICE CG84：5岁以下儿童胃肠炎喂养建议',url='https://www.nice.org.uk/guidance/cg84/chapter/Recommendations',summary='无脱水时继续平常喂养，包括母乳和其他奶类；补液后恢复平常饮食和足浓度奶液。避免果汁和碳酸饮料。',applicability='急性胃肠炎、5岁以下；脱水补液阶段、明确不耐受、特殊疾病需区别处理。仅凭腹泻不能推定需要减奶。'),
 'aap-fontanel':dict(title='AAP HealthyChildren：婴儿首年检查与囟门',url='https://www.healthychildren.org/English/family-life/health-management/Pages/Visiting-The-Pediatrician-The-First-Year.aspx',summary='前囟通常在约18个月、第二个生日前闭合。',applicability='通常发育情况，不用于断言每个孩子实际闭合日期。未描述异常的近4岁孩子通常不适用婴儿囟门观察项目。'),
}
for key,s in sources.items():s.update(id=key,retrieved_at='2026-09-23',summary_author='Codex 检索整理，非来源原文，未作临床审核')
def focus(rid,needle,dimension,title,check,impact,improvement,source_ids=()):
 r=next(r for r in rows if r['id']==rid)
 quote=next(x for x in r['answer'].splitlines() if needle in x)
 return dict(row_id=rid,dimension=dimension,title=title,quote=quote,check=check,impact=impact,improvement=improvement,source_ids=list(source_ids),author='Codex 产品审阅候选；JEV 独立判断，不是 JEV 生成的解释')
focuses=[
 focus('CMD010-turn-1','半个多月','factual_grounding','病程和症状是否被改写','问题只给了11月15日至今、有白带；核对回答中的持续时长和白带增多是否有输入依据。','无依据的个人事实可能进入就诊摘要并影响后续追问。','保留原始日期，追问开始年份和实际持续时间；不要把有白带改为增多。'),
 focus('CMD008-turn-1','想了解**有没有排卵','evidence_consistency','内膜检查的用途与适应证','核对把内膜检查用于了解排卵/黄体功能的表述，是否说明常规不孕评估的限制；区分其他病理适应证。','可能强化过时的检查用途认知。','先澄清原医生的检查目的，区分病理取样和常规排卵评估，不直接否定具体处方。',['asrm-biopsy']),
 focus('CMD017-turn-1','药流常用的','evidence_consistency','暂停哺乳是否被概括为通用要求','比较一般暂停哺乳的说法与短期用药、足月健康婴儿条件下可继续哺乳的资料；是否足够区分特殊方案和通常情形？','可能造成不必要的停奶安排与焦虑；具体用药仍需医生核对。','明确药物方案、婴儿情况及说明书差异，避免把暂停哺乳作为普遍结论。',['sps-lactation']),
 focus('CMD021-turn-1','才达到不孕症','evidence_consistency','不孕就诊时机的年龄条件','核对一年才达到就诊标准是否遗漏年龄和已知病史例外；提问年龄是否已经修正前面的通用断言？','部分用户可能误以为必须等满一年才能求诊。','说明评估时机随年龄和病史变化，再收集个体信息。',['asrm-timing']),
 focus('CMD039-turn-1','减少奶量','evidence_consistency','腹泻减奶建议的适用条件','问题是否已提供脱水补液阶段或乳糖不耐受等适用条件？核对减奶建议与通常喂养原则。','不加条件的饮食限制可能降低可用性并影响营养摄入。','先核对特殊适用条件，区分奶类与含糖饮料。',['nice-feeding']),
 focus('CMD039-turn-1','囟门','evidence_consistency','危险信号是否适合患者年龄','问题是3岁9个月儿童，核对囟门观察是否属于适合该年龄的通用建议。','家长可能寻找通常已闭合的囟门，降低风险提示的可操作性。','按年龄筛选危险信号，保留尿量、精神、饮水能力等适用观察项。',['aap-fontanel']),
]
# All rows receive the same narrow product checks; medical retrieval is targeted, not comprehensive.
for r in rows:
 fs=[f for f in focuses if f['row_id']==r['id']]
 ids=list(dict.fromkeys(k for f in fs for k in f['source_ids']))
 r['review_focus']=fs;r['clinical_evidence']=[sources[k] for k in ids]
 state=json.loads((local/'jev-state'/f"{r['id']}.state.json").read_text())
 state['evaluation_profile']='medical-evidence-v3'
 state['product_contract']['evaluation_profile']='medical-evidence-v3'
 state['clinical_evidence']=r['clinical_evidence']
 # Exclude impact/fix hypotheses from JEV input to avoid feeding it a desired verdict.
 state['review_focus']=[{k:f[k] for k in ['dimension','quote','check','source_ids']} for f in fs]
 r['product_contract']=state['product_contract']
 out=local/'jev-state-v3';out.mkdir(exist_ok=True)
 (out/f"{r['id']}.state.json").write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
(data/'jev-audit-rows.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
(data/'clinical-evidence-v3.json').write_text(json.dumps({'sources':list(sources.values()),'focuses':focuses,'coverage':'50条全部复评产品维度；4条QA有针对性医学证据核验；其余不视为医学正确性已验证。'},ensure_ascii=False,indent=2)+'\n')
print('Prepared',len(rows),'QA;',len(focuses),'focuses;',len(sources),'source summaries')
