import {readFile,mkdir,open,unlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {locations,ROOT,VERSION,read,save,hash,buildInput,validateReview,validateClusters,clusterInput,normalizeClusters,aggregate,callModel} from './core.mjs';
import {signals} from '../jev/dashboard/shared.mjs';
export async function run({dataset='physician',limit=Infinity,workers=3,exportOnly=false}={}){
 const loc=locations(dataset);await mkdir(loc.review,{recursive:true});const lock=path.join(loc.review,'run.lock');
 const lockDeadline=Date.now()+45*60_000;
 for(;;){try{const handle=await open(lock,'wx');await handle.writeFile(String(process.pid));await handle.close();break;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>lockDeadline)throw Error('等待已有复核任务超时，请检查进程');await new Promise(r=>setTimeout(r,5000));}}
 try{
 const rows=(await readFile(path.join(loc.data,'jev-labels.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const system=await readFile(path.join(ROOT,'config/review/qa-review.md'),'utf8'),clusterSystem=await readFile(path.join(ROOT,'config/review/cluster.md'),'utf8');
 const records=[],errors=[],todo=[];
 for(const row of rows){
  const signal=signals(row.answers);const reason=signal.queues.includes('badcase_candidate')?'jev_candidate':signal.queues.includes('uncertain')||signal.queues.includes('missing_evidence')?'jev_review':'negative_spotcheck';
  // The pilot is fully reviewed; the expanded batch also keeps a deterministic 10% negative sample.
  if(dataset!=='physician'&&reason==='negative_spotcheck'&&parseInt(hash(row.id).slice(0,4),16)%10!==0)continue;
  let request;try{request=await read(path.join(loc.local,'jev-results-v1',row.id+'.precompact.request.json'));}catch(e){if(e.code!=='ENOENT')throw e;request=await read(path.join(loc.local,'jev-results-v1',row.id+'.request.json'));}
  if(request.state.current.query.text!==row.query||request.state.current.answer.text!==row.answer)throw Error('Review QA source mismatch');const targetFields=[...new Set([...signal.uncertain,...Object.entries(row.answers).filter(([k,v])=>['issue_detected','partial','off_target','major_rework','unusable','unsupported_claim','partial_support','contradicted','irrelevant'].includes(v.choice)).map(([k])=>k)])];const input=buildInput(request,targetFields);const digest=hash({system,input,model:'deepseek-flash',version:VERSION});
  const file=path.join(loc.review,row.id+'.json');let cached;try{cached=await read(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(cached?.input_sha256===digest){records.push(cached);continue;}
  if(cached)await save(path.join(loc.review,'archive',row.id+'-'+cached.input_sha256+'.json'),cached);
  todo.push({row,input,digest,file,reason});
 }
 const started=new Date().toISOString();let serial=Promise.resolve(),clusterMetadata=null;
 const snapshot=async(status='running',clusters=[])=>{
  const data={version:VERSION,dataset,status,jev_evaluated_qa:rows.length,jev_input_sha256:hash(rows.map(r=>[r.id,r.evaluation_input_sha256])),started_at:started,updated_at:new Date().toISOString(),total:records.length+todo.length,completed:records.length,failed:errors.length,errors,records:[...records].sort((a,b)=>a.qa_id.localeCompare(b.qa_id)),clusters,cluster_status:status==='running'?'waiting_for_reviews':clusters.length?'completed':'no_actionable_findings',cluster_metadata:clusterMetadata,metrics:{requests:records.length+(clusterMetadata?1:0),tokens:records.reduce((n,r)=>n+(r.metadata.usage?.total_tokens??0),clusterMetadata?.usage?.total_tokens??0),duration_ms:records.reduce((n,r)=>n+r.metadata.duration_ms,clusterMetadata?.duration_ms??0),cost:null},prompts:{review:system,cluster:clusterSystem}};
  // total uses a frozen selected count, not a changing queue length.
  data.total=total;
  await save(path.join(loc.data,'ds-review.json'),data);
 };
 const total=records.length+todo.length;const pending=todo.slice(0,Number(limit));let next=0;
 const write=()=>{serial=serial.then(()=>snapshot());return serial;};await write();
 if(!exportOnly)await Promise.all(Array.from({length:Math.min(workers,pending.length)},async()=>{
  for(;;){const item=pending[next++];if(!item)break;let last;
   for(let attempt=1;attempt<=3;attempt++){
    try{
     const result=await callModel(system,item.input);validateReview(result.content,item.input);
     const record={qa_id:item.row.id,session_id:item.row.session_id,preset:item.row.agent_preset,entry_reason:item.reason,input_sha256:item.digest,version:VERSION,...result.content,findings:result.content.findings.map((f,i)=>({...f,id:item.row.id+'-f'+(i+1),qa_id:item.row.id,session_id:item.row.session_id})),metadata:result.metadata};
     await save(item.file,record);await save(path.join(loc.review,item.row.id+'.request.json'),{system,input:item.input});records.push(record);last=null;console.log(JSON.stringify({id:item.row.id,status:'reviewed',findings:record.findings.length,duration_ms:record.metadata.duration_ms}));break;
    }catch(e){last=e;await save(path.join(loc.review,item.row.id+'.error.json'),{at:new Date().toISOString(),attempt,message:e.message});if([401,403,402].includes(e.status))break;await new Promise(r=>setTimeout(r,attempt*2000));}
   }
   if(last){errors.push({id:item.row.id,message:last.message});console.log(JSON.stringify({id:item.row.id,status:'failed',message:last.message}));}
   await write();
  }
 }));
 const findings=records.flatMap(r=>r.findings).filter(f=>f.verdict!=='refuted').sort((a,b)=>a.id.localeCompare(b.id));let clusters=[];
 if(findings.length&&!exportOnly){
  const input=clusterInput(findings);
  const fingerprint=hash({clusterSystem,input,thinking:false});const file=path.join(loc.review,'clusters-'+fingerprint+'.json');let cached;try{cached=await read(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!cached){let last,previous;for(let attempt=1;attempt<=4;attempt++){let result;const payload=previous?{...input,repair:{error:last.message,previous_proposal:previous,instructions:'修正列出的结构问题，同时检查所有成员恰好出现一次且kind正确。返回完整clusters和assignments，包含每个输入F编号。'}}:input;try{result=await callModel(clusterSystem,payload,{maxTokens:14000,thinking:false});const normalized=normalizeClusters(result.content,findings);cached={input_sha256:fingerprint,...result,raw_content:result.content,content:normalized,normalization:'assignment_map_to_original_finding_ids'};await save(file,cached);last=null;break;}catch(e){last=e;if(result)previous=result.content;await save(path.join(loc.review,'clustering-attempt-'+Date.now()+'.error.json'),{attempt,message:e.message,proposal:result?.content});console.log(JSON.stringify({status:'clustering_retry',attempt,message:e.message}));}}if(last)errors.push({id:'clustering',message:last.message});}
  if(cached){clusterMetadata=cached.metadata;validateClusters(cached.content,findings);clusters=aggregate(cached.content.clusters,findings);}
 }
 await serial;await snapshot(errors.length?'completed_with_errors':records.length===total?'completed':'partial',clusters);
 console.log(JSON.stringify({status:'saved',selected:total,reviewed:records.length,failed:errors.length,clusters:clusters.length}));
 }finally{await unlink(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const{values}=parseArgs({options:{dataset:{type:'string',default:'physician'},limit:{type:'string'},workers:{type:'string',default:'3'},'export-only':{type:'boolean'}}});run({dataset:values.dataset,limit:Number(values.limit??Infinity),workers:Math.max(1,Math.min(4,Number(values.workers))),exportOnly:values['export-only']}).catch(e=>{console.error(e.message);process.exitCode=1;});}
