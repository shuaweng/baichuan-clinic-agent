import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EvaluationRunner} from './dashboard/runner.mjs';
import {buildRequest,runEvaluation} from './evaluate.mjs';
import {QUERY_QUESTIONS_V3,QA_QUESTIONS_V3,QUESTION_VERSION_V3} from './questions-v3.mjs';
import {attachProductReviewNotes} from './audit-notes.mjs';
import {metrics} from './dashboard/shared.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),data=path.join(root,'data/chinese-medical-50'),local=path.join(root,'.local/chinese-medical-50-20260923');
const rows=(await readFile(path.join(data,'jev-audit-rows.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const states=new Map(await Promise.all(rows.map(async r=>[r.id,JSON.parse(await readFile(path.join(local,'jev-state-v3',r.id+'.state.json'),'utf8'))])));
const raw=path.join(local,'jev-results-v3');await mkdir(raw,{recursive:true});
const evaluator=async request=>{
  const {createHash}=await import('node:crypto');const key=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  await writeFile(path.join(raw,key+'.request.json'),JSON.stringify(request,null,2));
  try{const cached=JSON.parse(await readFile(path.join(raw,key+'.result.json'),'utf8'));if(cached.input_sha256===key)return cached;}catch(error){if(error.code!=='ENOENT')throw error;}
  const result=await runEvaluation(request);await writeFile(path.join(raw,key+'.result.json'),JSON.stringify(result,null,2));return result;
};
const runner=new EvaluationRunner({directory:path.join(local,'runs-v3'),states,evaluate:evaluator});await runner.init();
let run=runner.list()[0];
if(!run)run=await runner.create(rows.map(r=>r.id));
else if(['paused','interrupted','completed_with_errors'].includes(run.status))await runner.action(run.id,run.items.some(i=>Object.values(i.modes).some(m=>m.status==='failed'))?'retry':'resume');
let previous=-1;
const publish=async r=>{
  const n=metrics(r.items).requests;if(n!==previous){previous=n;console.log('EVALUATED',n,'/ 100',r.status);}
};
runner.on('update',publish);
while(['running','pausing','cancelling'].includes(run.status))await new Promise(resolve=>setTimeout(resolve,1000));
if(run.status!=='completed')throw new Error('Batch not complete: '+run.status);
for(const row of rows){const item=run.items.find(i=>i.rowId===row.id);for(const mode of ['query','qa']){
 const request=buildRequest(states.get(row.id),mode);const {createHash}=await import('node:crypto');
 if(createHash('sha256').update(JSON.stringify(request)).digest('hex')!==item.modes[mode].result.inputSha256)throw new Error('Input mismatch');
}}
for(const item of run.items)item.ignoredFields=states.get(item.rowId).clinical_evidence?.length?[]:['evidence_consistency'];
await runner.save(run);
const history={...structuredClone(run),id:'chinese-medical-evidence-v3',name:'公开妇幼问题 · 证据复评',kind:'history'};
await writeFile(path.join(data,'jev-timeline-v3.json'),JSON.stringify(history,null,2));
await writeFile(path.join(data,'jev-evaluation-contract-v3.json'),JSON.stringify({question_version:QUESTION_VERSION_V3,product_contract:rows[0].product_contract,questions:{query:QUERY_QUESTIONS_V3,qa:QA_QUESTIONS_V3},reference_policy:'公开配对答案，仅供对照，非医学金标准'},null,2));
await writeFile(path.join(data,'jev-summary-v3.json'),JSON.stringify(metrics(history.items),null,2));
attachProductReviewNotes(rows,history);await writeFile(path.join(data,'jev-audit-rows.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log('COMPLETE',JSON.stringify(metrics(history.items)));
