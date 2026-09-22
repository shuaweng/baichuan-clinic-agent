import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {buildRequest,runEvaluation,formatEvaluationError} from './evaluate.mjs';
import {QUESTION_VERSION} from './questions.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BATCH=path.join(ROOT,'.local/maternal-fresh-50-20260922');
const OUT=path.join(BATCH,'jev-results-v1');
const {values}=parseArgs({options:{workers:{type:'string',default:'1'},'retry-failed':{type:'boolean',default:false}}});
const workers=Number(values.workers);
if(!Number.isInteger(workers)||workers<1||workers>6)throw new Error('workers must be 1..6');
if(!process.env.AI_GATEWAY_API_KEY?.trim())throw new Error('AI_GATEWAY_API_KEY missing');
await mkdir(OUT,{recursive:true,mode:0o700});
async function readOptional(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(file,data){const tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
const files=(await readdir(path.join(BATCH,'jev-state'))).filter(f=>f.endsWith('.state.json')).sort();
if(files.length!==100)throw new Error('Expected 100 prepared turn states');
const tasks=[];
for(const file of files){
 const state=JSON.parse(await readFile(path.join(BATCH,'jev-state',file),'utf8'));
 for(const mode of ['query','qa']){
  const request=buildRequest(state,mode);
  const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
  tasks.push({id:file.replace('.state.json','')+'-'+mode,mode,hash,request});
 }
}
const oldManifest=await readOptional(path.join(OUT,'manifest.json'));
if(oldManifest&&(oldManifest.question_version!==QUESTION_VERSION||JSON.stringify(oldManifest.requests)!==JSON.stringify(tasks.map(({id,mode,hash})=>({id,mode,hash}))))){
 throw new Error('Frozen batch inputs or questions changed; use a new evaluation batch');
}
await save(path.join(OUT,'manifest.json'),{question_version:QUESTION_VERSION,created_at:oldManifest?.created_at??new Date().toISOString(),resumed_at:new Date().toISOString(),request_count:tasks.length,workers,min_request_interval_ms:2500,requests:tasks.map(({id,mode,hash})=>({id,mode,hash})),note:'Fresh synthetic prompts with real DSH answers; no clinical gold labels.'});
let cursor=0,done=0,failed=0,skipped=0,fatal=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let nextRequestAt=0;
async function pacedEvaluation(request,id){
 for(let attempt=1;attempt<=5;attempt++){
  const slot=Math.max(Date.now(),nextRequestAt);
  nextRequestAt=slot+2500;
  await sleep(Math.max(0,slot-Date.now()));
  try{return await runEvaluation(request);}
  catch(error){
   const status=error.statusCode??error.cause?.statusCode;
   if(![429,500,502,503,504].includes(status)||attempt===5)throw error;
   const headers=error.responseHeaders??error.cause?.responseHeaders??{};
   const seconds=Number(headers['retry-after']);
   const delay=Math.max(Number.isFinite(seconds)?seconds*1000:0,5000*attempt);
   nextRequestAt=Math.max(nextRequestAt,Date.now()+delay);
   console.log(`RETRY ${status} ${id}: retry ${attempt}/4 after ${delay}ms`);
   await sleep(delay);
  }
 }
}
async function worker(){
 while(!fatal&&cursor<tasks.length){
  const task=tasks[cursor++],file=path.join(OUT,task.id+'.result.json');
  const previous=await readOptional(file);
  if(previous){
   if(previous.request_sha256!==task.hash)throw new Error('Input changed for '+task.id+'; use a new evaluation batch');
   if(previous.status==='evaluated'){done++;skipped++;continue;}
   if(!values['retry-failed']){failed++;continue;}
  }
  await save(path.join(OUT,task.id+'.request.json'),task.request);
  const started=Date.now();
  try{
   const result=await pacedEvaluation(task.request,task.id);
   await save(file,{task_id:task.id,mode:task.mode,request_sha256:task.hash,duration_ms:Date.now()-started,...result});
   done++;
   if(done%10===0)console.log(`PROGRESS ${done}/${tasks.length} successful; ${failed} failed`);
  }catch(error){
   const status=error.statusCode??error.cause?.statusCode;
   await save(file,{task_id:task.id,mode:task.mode,request_sha256:task.hash,status:'failed',http_status:status??null,message:formatEvaluationError(error),attempted_at:new Date().toISOString()});
   failed++;console.log(`FAILED ${task.id}: ${formatEvaluationError(error)}`);
   if(status===401||status===403)fatal=true;
  }
 }
}
console.log(`START ${tasks.length} requests, ${workers} workers, ${QUESTION_VERSION}`);
await Promise.all(Array.from({length:workers},worker));
console.log(JSON.stringify({completed:done,failed,skipped,not_started:tasks.length-cursor,directory:OUT}));
if(done!==tasks.length)process.exitCode=1;
