#!/usr/bin/env python3
"""Verify the completed batch and export readable QA plus isolated Jev state files."""
import collections,csv,json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'.local/maternal-fresh-50-20260922'
DEST=ROOT/'data/session-batch-50'
STATES=SOURCE/'jev-state'
scenarios=[json.loads(s) for s in (DEST/'scenarios.jsonl').read_text().splitlines()]
records=[json.loads((SOURCE/(s['scenario_id']+'.json')).read_text()) for s in scenarios]
assert len(records)==50 and all(r['status']=='completed' for r in records),'Batch not complete'
assert len({r['session_id'] for r in records})==50
assert all(len(r['turns'])==2 for r in records)
assert len({tuple(r['system_prompt_hashes']) for r in records})==1,'Prompt changed during generation'
for s,r in zip(scenarios,records):
 assert [t['user'] for t in s['turns']]==[t['query'] for t in r['turns']]
 for t in r['turns']:
  assert t['answer'].strip() and t['completion']['kind']=='completed'
  assert t['query_event_seq']<min(t['answer_event_seqs'])<=max(t['answer_event_seqs'])<t['end_event_seq']

contract={
 'version':'local-dsh-maternal-batch-20260922',
 'service_scope':['所有年龄段女性的妇女保健、妇科与产科','0–18岁儿童青少年的儿童保健与儿科','生殖健康、避孕、生育规划与筛查','上述服务相关的产品身份与使用咨询'],
 'response_expectations':['回应用户本轮实际诉求，需要时追问关键缺失信息','复用已知事实，区分不同人的信息，接受用户纠正','不虚构诊断、处方、医疗资质或工具执行成功','按实际可读报告和真实工具结果解释，不编造附件或医学证据'],
 'capability_snapshot':{'basis':'批次生成时本地妇幼 persona 配置；不是医学效果验证','text_assistance':'configured','text_summary_in_chat':'configured','medical_knowledge_retrieval':'not_integrated','persistent_health_records':'not_integrated','appointment_or_reminder_execution':'not_integrated','cross_account_sharing':'not_integrated','hospital_record_access':'not_integrated','image_reading':'unknown_for_this_request'}}
STATES.mkdir(parents=True,exist_ok=True)
lines=['# 50组妇幼专科会话：真实 DSH 回答','',
'用户问题为本次全新编写的合成场景；所有助手回答均通过当前 DSH 生成。每个 Session 2轮，共100轮。未使用已有 docs 或旧 query 样本。',
'采样分组不是需求占比，也不是评估金标准。本文保留模型原始回答，不构成医学审核结论。未调用 Jev 评分。','']
index=[]
for r in records:
 lines.extend([f"## {r['scenario_id']} · {r['title']}",'',f"分组：{r['sampling_group']}  · DSH Session：`{r['session_id']}`",''])
 for i,t in enumerate(r['turns']):
  lines.extend([f"### 第{i+1}轮 · 用户",'',t['query'],'',f"### 第{i+1}轮 · DSH回答",'',t['answer'],''])
  state={'product_contract':contract,
   'current':{'turn_id':t['turn_id'],'query':{'evidence_id':f"e{t['query_event_seq']}",'text':t['query']},'answer':{'evidence_id':','.join(f'e{x}' for x in t['answer_event_seqs']),'text':t['answer']},'completion':t['completion']},
   'history':[{'turn_id':h['turn_id'],'user':h['query'],'assistant':h['answer'],'query_event_seq':h['query_event_seq'],'answer_event_seqs':h['answer_event_seqs']} for h in r['turns'][:i]],
   'context_selection':{'available_previous_turns':i,'included_previous_turns':i,'omitted_previous_turns':0,'truncated':False},
   'relevant_facts':[],'attachments':[],
   'execution':{'observation_status':'complete_for_closed_turn' if t['tool_result_count']==0 else 'tool_details_not_exported','tool_calls':[],'tool_results':[],'evidence_cutoff':f"e{t['end_event_seq']}"},
   'evidence_limitations':{'retrieved_medical_evidence':'none','known_requirement_backlog':'not_provided','clinical_correctness':'not_evaluated','attachment_collection':'no_uploaded_attachments'}}
  target=STATES/f"{r['scenario_id']}-turn-{i+1}.state.json"
  target.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
  index.append({'scenario_id':r['scenario_id'],'sampling_group':r['sampling_group'],'title':r['title'],'session_id':r['session_id'],'turn_id':t['turn_id'],'query':t['query'],'answer_chars':len(t['answer']),'duration_seconds':round((t['ended_at']-t['started_at'])/1000,2),'jev_state_path':str(target)})
(DEST/'sessions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records))
(DEST/'sessions.md').write_text('\n'.join(lines))
with (DEST/'index.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=list(index[0]));w.writeheader();w.writerows(index)
usage=collections.Counter()
for r in records:
 for t in r['turns']:
  for u in t['usage']:
   for k,v in u.items():
    if isinstance(v,(int,float)):usage[k]+=v
summary={'sessions':len(records),'answered_turns':len(index),'sampling_groups':dict(collections.Counter(r['sampling_group'] for r in records)),
 'models':records[0]['model_requested'],'unique_system_prompt_snapshots':len({tuple(r['system_prompt_hashes']) for r in records}),
 'median_turn_seconds':round(statistics.median(x['duration_seconds'] for x in index),2),'usage_as_reported_by_dsh':dict(usage),
 'total_answer_chars':sum(x['answer_chars'] for x in index),'tool_result_count':sum(t['tool_result_count'] for r in records for t in r['turns']),
 'jev_states':len(index),'jev_evaluation':'not_run','medical_review':'not_performed','source':'fresh_synthetic_user_prompts_and_live_dsh_answers'}
(DEST/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
