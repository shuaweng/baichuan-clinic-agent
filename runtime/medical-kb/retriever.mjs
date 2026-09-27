import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';

// One warm local worker per DSH process; no patient text sent to another service.
let worker, idle, sequence=0;
const pending=new Map();
function stop(error=new Error('Medical retrieval worker stopped')) {
  const child=worker; worker=undefined; clearTimeout(idle);
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(error);}
  pending.clear(); child?.kill();
}
function start() {
  if(worker)return worker;
  const python=fileURLToPath(new URL('../../.local/medical-rag-venv/bin/python',import.meta.url));
  const child=spawn(python,[fileURLToPath(new URL('./retriever.py',import.meta.url))],{
    stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH??'',HAYSTACK_TELEMETRY_ENABLED:'False',HAYSTACK_CONTENT_TRACING_ENABLED:'False'}
  });
  worker=child;
  // Never echo queries, credentials or tracebacks into the application's UI.
  child.stderr.resume();
  child.stdin.on('error',()=>{if(worker===child)stop(new Error('Medical retrieval pipe failed'));});
  child.on('error',()=>{if(worker===child)stop(new Error('Medical retrieval unavailable; install runtime/medical-kb/requirements.txt in .local/medical-rag-venv'));});
  child.on('exit',()=>{if(worker===child)stop(new Error('Medical retrieval worker exited'));});
  createInterface({input:child.stdout}).on('line',line=>{
    let result;try{result=JSON.parse(line);}catch{return;}
    const task=pending.get(result.id);if(!task)return;
    pending.delete(result.id);clearTimeout(task.timer);
    result.error?task.reject(new Error(result.error)):task.resolve(result.results);
    if(!pending.size){clearTimeout(idle);idle=setTimeout(()=>stop(),30_000);idle.unref();}
  });
  return child;
}
export function retrieve(request) {
  return new Promise((resolve,reject)=>{
    const child=start();clearTimeout(idle);
    const id=++sequence;
    const timer=setTimeout(()=>stop(new Error('Medical retrieval timed out')),20_000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({...request,id})+'\n');
  });
}
export const closeRetriever=()=>stop();
process.once('exit',()=>worker?.kill());
