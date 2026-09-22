#!/usr/bin/env python3
"""Drive the running DSH via its authenticated RPC; never fabricate answers."""
import argparse, concurrent.futures, hashlib, http.cookiejar, json, re, threading, time, urllib.request, uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE='http://127.0.0.1:3080'
BATCH='maternal-fresh-50-20260922'
OUT=ROOT/'.local'/BATCH
WORKSPACE=ROOT/'.local/dsh-batch-workspace'
PRESET='maternal-preview'
PRINT_LOCK=threading.Lock()

def log(message):
    with PRINT_LOCK: print(message,flush=True)

def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    tmp.replace(path)

class Client:
    def __init__(self):
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        urls=re.findall(r'dsh web: (http://127\.0\.0\.1:3080/\?token=\S+)',(ROOT/'.local/logs/dsh.log').read_text())
        if not urls: raise RuntimeError('DSH startup URL unavailable')
        self.opener.open(urls[-1],timeout=15).read()
    def rpc(self,method,args):
        data={'type':'client-request','rpcId':str(uuid.uuid4()),'method':method,'payload':{'args':args}}
        request=urllib.request.Request(BASE+'/api/'+method,data=json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':BASE})
        with self.opener.open(request,timeout=40) as response: result=json.load(response)['result']
        if not result['ok']: raise RuntimeError(json.dumps(result['error'],ensure_ascii=False))
        return result.get('value')
    def row(self,sid):
        return next((x for x in self.rpc('session/list',{'_request':{}})['items'] if x['sessionId']==sid),None)
    def events(self,row):
        page=self.rpc('session/page',{'request':{'address':{'kind':'session','sessionId':row['sessionId']},'throughSeq':row['projections']['asOfSeq'],'maxMessages':200}})
        if page['hasMore']: raise RuntimeError('Unexpected pagination: refusing to export truncated history')
        return [x['event'] for x in page['records']]


def text(content):
    return '\n'.join(x['text'] for x in content if x.get('type')=='text' and isinstance(x.get('text'),str))

def extract(events,rid):
    user=next((e for e in events if e['type']=='user/message' and e['data'].get('source',{}).get('rpcId')==rid),None)
    if not user: return None
    start=next((e for e in reversed(events) if e['seq']<user['seq'] and e['type']=='turn/start'),None)
    if not start: raise RuntimeError('Accepted user message has no turn/start')
    turn=start['data']['turn']
    end=next((e for e in events if e['type']=='turn/end' and e['data']['turn']==turn and e['seq']>user['seq']),None)
    if not end: return None
    answers=[e for e in events if e['type']=='assistant/message' and e['data'].get('turn')==turn and user['seq']<e['seq']<end['seq']]
    tools=[e for e in events if e['type']=='tool/result' and e['data'].get('turn')==turn]
    answer='\n\n'.join(text(e['data']['message']['content']) for e in answers).strip()
    return {'turn_id':turn,'query':text(user['data']['content']),'answer':answer,'completion':end['data']['reason'],
        'query_event_seq':user['seq'],'answer_event_seqs':[e['seq'] for e in answers],'end_event_seq':end['seq'],
        'started_at':start['time'],'ended_at':end['time'],'tool_result_count':len(tools),
        'usage':[e['data'].get('usage') for e in answers if e['data'].get('usage')]}

def run(scenario,model):
    sid='session-'+str(uuid.uuid5(uuid.NAMESPACE_URL,BATCH+'/'+scenario['scenario_id']))
    path=OUT/(scenario['scenario_id']+'.json')
    record=json.loads(path.read_text()) if path.exists() else {'batch_id':BATCH,'scenario_id':scenario['scenario_id'],'title':scenario['title'],'sampling_group':scenario['sampling_group'],'source':'synthetic_user_prompts_with_live_dsh_answers','session_id':sid,'agent_preset':PRESET,'model_requested':model,'turns':[],'status':'pending'}
    if record['status']=='completed':
        log(f"SKIP {scenario['scenario_id']} completed")
        return record
    save(path,record)
    try:
        client=Client()
        client.rpc('session/create',{'request':{'sessionId':sid,'cwd':str(WORKSPACE),'agentPreset':PRESET}})
        client.rpc('session/selectModel',{'request':{'sessionId':sid,**model}})
        for planned in scenario['turns']:
            if len(record['turns'])>=planned['index']: continue
            rid=str(uuid.uuid5(uuid.NAMESPACE_URL,BATCH+'/'+scenario['scenario_id']+'/'+str(planned['index'])))
            row=client.row(sid); events=client.events(row)
            existing=extract(events,rid)
            if not existing:
                accepted=any(e['type']=='user/message' and e['data'].get('source',{}).get('rpcId')==rid for e in events)
                previous_pending=record.get('pending_request_id')==rid
                if not accepted and not previous_pending:
                    record.update(status='running',pending_request_id=rid)
                    save(path,record)
                    # Do not automatically resend an uncertain admission.
                    client.rpc('session/prompt',{'request':{'sessionId':sid,'requestId':rid,'mode':'queue','content':[{'type':'text','text':planned['user']}],'clientTimeZone':'Asia/Shanghai'}})
                deadline=time.monotonic()+180
                while time.monotonic()<deadline:
                    time.sleep(2)
                    row=client.row(sid)
                    if row['running']: continue
                    events=client.events(row)
                    existing=extract(events,rid)
                    if existing: break
                if not existing: raise RuntimeError('No completed turn after 180s; left session intact, no duplicate prompt sent')
            if existing['query']!=planned['user']: raise RuntimeError('Returned query differs from authored query')
            if existing['completion'].get('kind')!='completed' or not existing['answer']:
                raise RuntimeError('DSH turn failed or produced no answer: '+json.dumps(existing['completion']))
            record['turns'].append(existing)
            record.pop('pending_request_id',None)
            save(path,record)
            log(f"TURN {scenario['scenario_id']} {len(record['turns'])}/2 answer_chars={len(existing['answer'])}")
        client.rpc('session/rename',{'request':{'sessionId':sid,'title':f"[50组] {scenario['scenario_id']} {scenario['title']}"}})
        events=client.events(client.row(sid))
        systems=[e for e in events if e['type']=='system/message']
        routes=[{'event_seq':e['seq'],**{k:e['data'][k] for k in ['provider','model','reasoningEffort'] if k in e['data']}} for e in events if e['type']=='request/context']
        record.update(status='completed',model_routes=routes,system_prompt_hashes=[hashlib.sha256(text(e['data']['message']['content']).encode()).hexdigest() for e in systems],finished_at=time.time())
        save(path,record)
        log(f"DONE {scenario['scenario_id']} {sid}")
    except Exception as error:
        record.update(status='error',error=str(error)[:1200]);save(path,record)
        log(f"ERROR {scenario['scenario_id']} {type(error).__name__}: {str(error)[:160]}")
    return record

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--limit',type=int,default=50);parser.add_argument('--workers',type=int,default=3)
    args=parser.parse_args()
    if not 1<=args.limit<=50 or not 1<=args.workers<=3: parser.error('limit 1..50; workers 1..3')
    scenarios=[json.loads(line) for line in (ROOT/'data/session-batch-50/scenarios.jsonl').read_text().splitlines()][:args.limit]
    WORKSPACE.mkdir(parents=True,exist_ok=True)
    client=Client(); model=client.rpc('session/modelCatalog',{})['default']
    # Match the effort observed on the user's current DSH conversation.
    model={**model,'reasoningEffort':'high'}
    save(OUT/'batch.json',{'batch_id':BATCH,'model':model,'preset':PRESET,'requested_count':50,'turns_per_session':2,'scenario_sha256':hashlib.sha256((ROOT/'data/session-batch-50/scenarios.jsonl').read_bytes()).hexdigest()})
    log('MODEL '+json.dumps(model))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        records=list(pool.map(lambda s:run(s,model),scenarios))
    complete=[r for r in records if r['status']=='completed']
    dest=ROOT/'data/session-batch-50/sessions.jsonl'
    dest.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in complete))
    log(f'FINISHED {len(complete)}/{len(scenarios)} sessions; {sum(len(r["turns"]) for r in complete)} answered turns; {dest}')
    if len(complete)!=len(scenarios): raise SystemExit(1)

if __name__=='__main__':main()
