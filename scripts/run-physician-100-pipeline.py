"""Run incremental JEV and DS evaluation on real completed DSH sessions."""
import json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'data/physician-tasks-100';LOCAL=ROOT/'.local/physician-tasks-100-v1'
env={**os.environ,'PHYSICIAN_DATASET':'physician-100','JEV_WORKERS':'2'}
def run(args):
 return subprocess.run(args,cwd=ROOT,env=env).returncode
last=0;rounds=0
while rounds<12:
 records=[json.loads(p.read_text()) for p in LOCAL.glob('D[0-9][0-9][0-9].json')];complete=[r for r in records if r['status']=='completed'];n=sum(len(r['turns']) for r in complete)
 if n-last<16 and len(complete)<100:time.sleep(20);continue
 rounds+=1;print(json.dumps({'pipeline_round':rounds,'completed_sessions':len(complete),'qa':n}),flush=True)
 if run([sys.executable,'scripts/export-physician-100-progress.py']):raise SystemExit('Export verification failed')
 if run(['node','--env-file-if-exists=.env.local','runtime/jev/evaluate-physician-batch.mjs']):raise SystemExit('JEV request failure; saved for resume')
 if run(['node','runtime/review/run.mjs','--dataset','physician-100','--workers','4']):raise SystemExit('DS review failure; saved for resume')
 last=n
 if len(complete)==100:
  jev=json.loads((DATA/'jev-summary.json').read_text());ds=json.loads((DATA/'ds-review.json').read_text())
  if jev['evaluated_qa']==n and ds['status']=='completed' and ds.get('jev_evaluated_qa')==n:print('PIPELINE_COMPLETE',flush=True);break
  time.sleep(10)
else:raise SystemExit('Review rounds exhausted; inspect saved errors')
