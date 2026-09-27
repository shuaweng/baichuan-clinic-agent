"""Export only completed DSH sessions; preserve their actual events and answers."""
import importlib.util,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data/physician-tasks-100';LOCAL=ROOT/'.local/physician-tasks-100-v1'
spec=importlib.util.spec_from_file_location('transport',ROOT/'scripts/run-dsh-session-batch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
scenarios={r['scenario_id']:r for r in map(json.loads,(DATA/'scenarios.jsonl').read_text().splitlines())};manifest=json.loads((DATA/'manifest.json').read_text());client=None;records=[];inputs=[]
for sid,scenario in scenarios.items():
 p=LOCAL/(sid+'.json')
 if not p.exists():continue
 result=json.loads(p.read_text())
 if result['status']!='completed':continue
 assert len(result['turns'])==len(scenario['turns'])
 result['source']='research_informed_synthetic_physician_tasks_with_live_dsh_answers';result['task_type']=scenario['task_type'];records.append(result)
 ep=LOCAL/'events'/(sid+'.json')
 if ep.exists():events=json.loads(ep.read_text())
 else:
  if client is None:client=m.Client()
  events=[e for e in client.events(client.row(result['session_id'])) if e['type'] in {'user/message','assistant/message','tool/result','turn/start','turn/end','request/context'}];m.save(ep,events)
 for index,turn in enumerate(result['turns']):
  assert turn['query']==scenario['turns'][index]['user']
  tools=[e for e in events if e['type']=='tool/result' and e['data'].get('turn')==turn['turn_id']]
  inputs.append({'id':sid+'-turn-'+str(index+1),'batch_id':'physician-tasks-100-v1','session_id':result['session_id'],'source':result['source'],'agent_preset':result['agent_preset'],'current':{'query':{'text':turn['query']},'answer':{'text':turn['answer']}},'history':[{'query':t['query'],'answer':t['answer']} for t in result['turns'][:index]],'task_contract':{'task_type':scenario['task_type'],'user_role':'physician_or_clinic_team','expected_checks':scenario['turns'][index]['expected_checks'],'unacceptable_errors':scenario['evaluation']['unacceptable_errors'],'clinical_expert_reviewed':False},'execution':{'tool_results':tools,'turn_log_complete':True},'provenance':{'query_event_seq':turn['query_event_seq'],'answer_event_seqs':turn['answer_event_seqs'],'end_event_seq':turn['end_event_seq'],'model_routes':result['model_routes'],'knowledge_corpus_sha256':manifest['knowledge_corpus_sha256']},'evaluation_status':'not_evaluated'})
tmp=DATA/'sessions.jsonl.tmp';tmp.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in records));tmp.replace(DATA/'sessions.jsonl')
m.save(DATA/'evaluation-inputs.json',inputs);m.save(DATA/'collection-status.json',{'batch_id':'physician-tasks-100-v1','completed_ids':[r['scenario_id'] for r in records],'completed_sessions':len(records),'answered_turns':len(inputs),'total_planned_sessions':100,'planned_turns':manifest['turn_count']})
subprocess.run([sys.executable,str(ROOT/'scripts/export-physician-pilot.py')],env={**os.environ,'PHYSICIAN_DATASET':'physician-100'},check=True)
