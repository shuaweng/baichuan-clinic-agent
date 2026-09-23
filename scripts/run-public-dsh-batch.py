#!/usr/bin/env python3
import importlib.util,json,hashlib,concurrent.futures,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('dsh_batch',ROOT/'scripts/run-dsh-session-batch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
m.BATCH='chinese-medical-50-20260923';m.OUT=ROOT/'.local'/m.BATCH;m.WORKSPACE=ROOT/'.local/dsh-public-medical-workspace';m.WORKSPACE.mkdir(exist_ok=True)
args=argparse.ArgumentParser();args.add_argument('--limit',type=int,default=50);ns=args.parse_args()
source=ROOT/'data/chinese-medical-50/scenarios.jsonl';scenarios=[json.loads(s) for s in source.read_text().splitlines()][:ns.limit]
for s in scenarios:s['batch_label']='公开数据50'
model={**m.Client().rpc('session/modelCatalog',{})['default'],'reasoningEffort':'high'}
manifest=m.OUT/'batch.json'
if manifest.exists() and json.loads(manifest.read_text())['scenario_sha256']!=hashlib.sha256(source.read_bytes()).hexdigest():raise SystemExit('Frozen source questions changed; use a new batch ID')
m.save(m.OUT/'batch.json',{'batch_id':m.BATCH,'model':model,'scenario_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'requested_count':50,'turns_per_session':1})
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:records=list(pool.map(lambda s:m.run(s,model),scenarios))
complete=[r for r in records if r['status']=='completed']
(ROOT/'data/chinese-medical-50/sessions.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in complete))
print(f'COMPLETE {len(complete)}/{len(scenarios)}')
if len(complete)!=len(scenarios):raise SystemExit(1)
