#!/usr/bin/env python3
import json,hashlib,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data/chinese-medical-50';LOCAL=ROOT/'.local/chinese-medical-50-20260923';STATES=LOCAL/'jev-state';STATES.mkdir(exist_ok=True)
scenarios=[json.loads(s) for s in (DATA/'scenarios.jsonl').read_text().splitlines()];rows=[];sessions=[]
base=json.loads((ROOT/'data/session-batch-50/jev-evaluation-contract.json').read_text())['product_contract']
for s in scenarios:
 r=json.loads((LOCAL/(s['scenario_id']+'.json')).read_text());assert r['status']=='completed';assert len(r['turns'])==1
 t=r['turns'][0];assert t['query']==s['turns'][0]['user'];assert t['answer'] and t['completion']['kind']=='completed';assert not t['tool_result_count']
 contract={**base,'version':s['agent_preset']+'-20260923','evaluation_profile':'medical-reference-v2','agent_preset':s['agent_preset'],'service_scope':['女性全生命周期妇科、产科、生殖健康与妇女保健'] if s['agent_preset']=='baichuan-gynecology' else ['出生至18岁儿童青少年的儿科诊疗辅助与儿童保健']}
 state={'evaluation_profile':'medical-reference-v2','product_contract':contract,'current':{'turn_id':t['turn_id'],'query':{'evidence_id':f"e{t['query_event_seq']}",'text':t['query']},'answer':{'evidence_id':','.join(f'e{x}' for x in t['answer_event_seqs']),'text':t['answer']},'completion':t['completion']},'history':[],'context_selection':{'truncated':False,'included_previous_turns':0},'reference_material':s['reference_material'],'execution':{'observation_status':'complete_for_closed_turn','tool_calls':[],'tool_results':[]},'evidence_limitations':{'reference_status':'公开历史回答未经临床审核，可能过时或错误；不是医疗金标准','patient_source':'来自公开仓库，未独立验证真实患者来源','clinical_guidelines':'未额外检索指南或药品说明书'}}
 ident=s['scenario_id']+'-turn-1';(STATES/(ident+'.state.json')).write_text(json.dumps(state,ensure_ascii=False,indent=2))
 rows.append({'id':ident,'title':s['title'],'scenario_id':s['scenario_id'],'sampling_group':s['sampling_group'],'session_id':r['session_id'],'turn_id':t['turn_id'],'query':t['query'],'answer':t['answer'],'previous_turns':[],'reference_material':s['reference_material'],'product_contract':contract,'agent_preset':s['agent_preset'],'provenance':{'query_event_seq':t['query_event_seq'],'answer_event_seqs':t['answer_event_seqs'],'model_routes':r['model_routes'],'prompt_hashes':r['system_prompt_hashes']}})
 sessions.append(r)
(DATA/'jev-labels.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in rows))
(DATA/'sessions.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in sessions))
print('EXPORTED',len(rows),'DSH answers, source references and isolated evaluation inputs')
