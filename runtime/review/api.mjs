import {readFile,mkdir,open,readdir} from 'node:fs/promises';import {spawn} from 'node:child_process';import path from 'node:path';
import {ROOT,locations,read,save} from './core.mjs';
const optional=async(p,fallback)=>{try{return await read(p);}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
export async function reviewData(dataset){const loc=locations(dataset);let rows=[];try{rows=(await readFile(path.join(loc.data,'jev-labels.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 const state=await optional(path.join(loc.data,'ds-review.json'),{status:'not_started',total:rows.length,completed:0,failed:0,records:[],clusters:[],metrics:{}});
 const decisions=await optional(path.join(loc.review,'decisions.json'),{});const progress=await optional(path.join(loc.data,'collection-status.json'),{});
 const manifest=await optional(path.join(loc.data,'manifest.json'),{});
 if(dataset==='physician-100'&&progress.completed_sessions!==manifest.session_count){const files=(await readdir(loc.local)).filter(f=>/^D\d{3}\.json$/.test(f));const collected=await Promise.all(files.map(f=>read(path.join(loc.local,f))));progress.completed_sessions=collected.filter(r=>r.status==='completed').length;progress.answered_turns=collected.reduce((n,r)=>n+r.turns.length,0);}progress.planned_sessions=manifest.session_count;progress.planned_turns=manifest.turn_count;
 const available=[];for(const id of ['physician','physician-100']){try{await read(path.join(locations(id).data,'manifest.json'));available.push({id,name:id==='physician'?'医生试评 · 9个会话':'医生场景 · 100个会话'});}catch{}}
 return {...state,dataset,rows,decisions,progress,datasets:available};}
let writes=Promise.resolve();
export async function decision(dataset,body,{locationOverride}={}){
 if(!['accepted','rejected','needs_evidence','unreviewed'].includes(body.status)||typeof body.finding_id!=='string'||typeof(body.note??'')!=='string'||(body.note??'').length>4000)throw Error('无效复核意见');
 const job=async()=>{const loc=locationOverride??locations(dataset),state=await read(path.join(loc.data,'ds-review.json'));if(!state.records.some(r=>r.findings.some(f=>f.id===body.finding_id)))throw Error('问题不存在');const file=path.join(loc.review,'decisions.json');const current=await optional(file,{});const previous=current[body.finding_id];if((previous?.revision??0)!==(body.revision??0))throw Error('该意见已更新，请刷新后重试');
 const entry={status:body.status,note:body.note??'',at:new Date().toISOString(),revision:(previous?.revision??0)+1,reviewer:'local_user',scope:'product_review_not_clinical_signoff',model_input_sha256:state.records.find(r=>r.findings.some(f=>f.id===body.finding_id)).input_sha256};
 const event=path.join(loc.review,'human-history',body.finding_id+'-'+entry.revision+'.json');await save(event,entry);current[body.finding_id]=entry;await save(file,current);return entry;};const promise=writes.then(job);writes=promise.catch(()=>{});return promise;
}
const children=new Map();
export async function startReview(dataset){locations(dataset);if(children.has(dataset))throw Error('复核正在运行');const loc=locations(dataset);await mkdir(loc.review,{recursive:true});const handle=await open(path.join(loc.review,'runner.log'),'a');const child=spawn(process.execPath,[path.join(ROOT,'runtime/review/run.mjs'),'--dataset',dataset],{cwd:ROOT,stdio:['ignore',handle.fd,handle.fd]});await handle.close();children.set(dataset,child);child.on('exit',()=>children.delete(dataset));return {status:'started'};}
