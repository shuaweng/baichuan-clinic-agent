import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const VERSION='deepseek-review-1.1';
export const fields=['task_completion','case_fidelity','medical_correctness','decision_usefulness','critical_omission','medication_safety','urgent_management','citation_support','evidence_applicability','uncertainty_management','deliverable_usability','audience_fit','execution_honesty','data_boundary'];
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const read=async p=>JSON.parse(await readFile(p,'utf8'));
export async function save(p,v){await mkdir(path.dirname(p),{recursive:true});const temp=p+'.'+process.pid+'.tmp';await writeFile(temp,JSON.stringify(v,null,2)+'\n',{mode:0o600});await rename(temp,p);}
export function locations(dataset='physician'){
 if(!['physician','physician-100'].includes(dataset))throw Error('Unknown dataset');
 const large=dataset==='physician-100';const data=path.join(ROOT,'data',large?'physician-tasks-100':'physician-tasks-50');const local=path.join(ROOT,'.local',large?'physician-tasks-100-v1':'physician-tasks-50-kb-v1');
 return {data,local,review:path.join(local,'ds-review-v1')};
}
export async function credential(){
 if(process.env.DEEPSEEK_API_KEY?.trim())return process.env.DEEPSEEK_API_KEY.trim();
 const text=await readFile(path.join(ROOT,'deepseek env.md'),'utf8');const keys=[...new Set(text.match(/sk-[A-Za-z0-9_-]{12,}/g)??[])];
 if(keys.length!==1)throw Error('DeepSeek 密钥文件需包含唯一有效 API key');return keys[0];
}
export function buildInput(request,targets=[]){
 const s=structuredClone(request.state);delete s.provenance;
 const refs=[{source_id:'query',text:s.current.query.text},...(s.current.answer.segments??[{id:'answer',text:s.current.answer.text}]).map(p=>({source_id:p.id,text:p.text??s.current.answer.text.slice(p.start,p.end)}))];
 for(const[h,t]of(s.history??[]).entries())refs.push({source_id:'history-'+(h+1)+'-query',text:t.query},{source_id:'history-'+(h+1)+'-answer',text:t.answer});
 for(const d of s.evidence?.documents??[])refs.push({source_id:d.id,text:d.text});
 return {dimensions:fields,review_targets:targets,state:s,reference_texts:refs,review_policy:'独立核查；未提供 JEV 分类、概率、人工抽查结论或回答模型身份。'};
}
export function validateReview(v,input){
 if(!v||typeof v.summary!=='string'||!Array.isArray(v.findings)||v.findings.length>6||!Array.isArray(v.checked_dimensions)||fields.some(f=>!v.checked_dimensions.includes(f)))throw Error('复核结构不完整');
 const refs=new Map(input.reference_texts.map(r=>[r.source_id,r.text]));
 if(!Array.isArray(v.assessments)||(input.review_targets??[]).some(d=>!v.assessments.some(a=>a.dimension===d))||v.assessments.length!==(input.review_targets??[]).length)throw Error('疑点复核未完整覆盖');
 for(const a of v.assessments){if(!input.review_targets.includes(a.dimension)||!['supported','refuted','inconclusive'].includes(a.verdict)||!a.explanation||!a.evidence?.length)throw Error('疑点复核格式错误');for(const e of a.evidence)if(typeof e.quote!=='string'||!e.quote.trim()||!refs.get(e.source_id)?.includes(e.quote))throw Error('疑点证据不能逐字匹配');if(a.verdict==='supported'&&!v.findings.some(f=>f.dimension===a.dimension&&f.verdict==='supported'))throw Error('成立疑点缺少对应发现');}
 for(const f of v.findings){
  if(!fields.includes(f.dimension)||!['supported','refuted','inconclusive'].includes(f.verdict)||!['answer_defect','capability_gap','potential_need','evaluation_issue'].includes(f.kind)||!/^P[0-3]$/.test(f.severity)||typeof f.requires_clinician!=='boolean'||!Array.isArray(f.missing_evidence))throw Error('复核分类不符合契约');
  for(const k of ['title','explanation','impact','next_action'])if(typeof f[k]!=='string'||!f[k].trim())throw Error('复核缺少说明');
  if(!Array.isArray(f.evidence)||!f.evidence.length)throw Error('发现没有证据定位');
  for(const e of f.evidence)if(typeof e.quote!=='string'||!e.quote.trim()||!refs.get(e.source_id)?.includes(e.quote))throw Error('证据引用无法逐字匹配');
 }
 return v;
}
export function validateClusters(value,findings){
 if(!Array.isArray(value?.clusters))throw Error('缺少聚类结果');const ids=new Map(findings.map(f=>[f.id,f]));const seen=new Set(),issues=[];
 for(const c of value.clusters){
  for(const k of ['title','kind','impact','next_action','why_read'])if(typeof c[k]!=='string'||!c[k].trim())throw Error('聚类字段缺失');
  if(!Array.isArray(c.finding_ids)||!c.finding_ids.length)throw Error('空聚类');
  for(const id of c.finding_ids){if(!ids.has(id)){issues.push('不存在的finding_id: '+id);continue;}if(seen.has(id))issues.push('重复finding_id: '+id);if(ids.get(id).kind!==c.kind)issues.push('kind不匹配: '+id+'必须为'+ids.get(id).kind+'，当前'+c.kind);seen.add(id);}
 }
 if(seen.size!==ids.size)issues.push('聚类遗漏成员: '+[...ids.keys()].filter(id=>!seen.has(id)).join(','));if(issues.length)throw Error(issues.join('; '));return value;
}
export function clusterInput(findings){
 return {findings:findings.map(({kind,title,dimension,verdict,severity,explanation,impact,next_action},i)=>({id:'F'+String(i+1).padStart(3,'0'),kind,title,dimension,verdict,severity,explanation,impact,next_action}))};
}
export function normalizeClusters(value,findings){
 if(!Array.isArray(value?.clusters)||!value.assignments||typeof value.assignments!=='object'||Array.isArray(value.assignments))throw Error('必须返回clusters数组和assignments对象');
 const aliases=new Map(findings.map((f,i)=>['F'+String(i+1).padStart(3,'0'),f]));
 const clusters=new Map();for(const c of value.clusters){if(typeof c.id!=='string'||clusters.has(c.id))throw Error('cluster id必须唯一');clusters.set(c.id,{...c,finding_ids:[]});}
 const missing=[...aliases.keys()].filter(id=>!Object.hasOwn(value.assignments,id));if(missing.length)throw Error('assignments遗漏: '+missing.join(','));
 for(const[id,cid]of Object.entries(value.assignments)){if(!aliases.has(id))throw Error('未知finding编号: '+id);if(!clusters.has(cid))throw Error('未知cluster编号: '+cid);const f=aliases.get(id),c=clusters.get(cid);if(f.kind!==c.kind)throw Error(id+'只能归入kind='+f.kind+'的分组');c.finding_ids.push(f.id);}
 const normalized={clusters:[...clusters.values()].filter(c=>c.finding_ids.length).map(({id,...c})=>c)};
 validateClusters(normalized,findings);return normalized;
}
export function aggregate(clusters,findings){const map=new Map(findings.map(f=>[f.id,f]));return clusters.map(c=>{const members=c.finding_ids.map(id=>map.get(id)),severity=members.map(f=>f.severity).sort()[0];return {...c,id:'cluster-'+hash([...c.finding_ids].sort()).slice(0,12),severity,qa_count:new Set(members.map(f=>f.qa_id)).size,session_count:new Set(members.map(f=>f.session_id)).size,supported:members.filter(f=>f.verdict==='supported').length,inconclusive:members.filter(f=>f.verdict==='inconclusive').length,requires_clinician:members.some(f=>f.requires_clinician),members};}).sort((a,b)=>a.severity.localeCompare(b.severity)||Number(b.supported>0)-Number(a.supported>0)||b.session_count-a.session_count||a.id.localeCompare(b.id));}
export async function callModel(system,input,{fetchImpl=fetch,key,maxTokens=14000,thinking=true}={}){
 const body={model:'deepseek-flash',messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],response_format:{type:'json_object'},thinking:{type:thinking?'enabled':'disabled'},...(thinking?{reasoning_effort:'low'}:{}),max_tokens:maxTokens};
 const started=Date.now();const response=await fetchImpl('https://api.deepseek.com/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(key??await credential())},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 if(!response.ok){await response.body?.cancel();throw Object.assign(Error('DeepSeek 请求失败（'+response.status+'）'),{status:response.status});}
 const raw=await response.json();if(raw.choices?.[0]?.finish_reason!=='stop')throw Error('DeepSeek 输出未完整结束');
 let content;try{content=JSON.parse(raw.choices[0].message.content);}catch{throw Error('DeepSeek 未返回有效 JSON');}
 return {content,metadata:{model:raw.model,request_id:raw.id,usage:raw.usage,duration_ms:Date.now()-started,evaluated_at:new Date().toISOString(),cost:null,cost_basis:'provider_did_not_return_billed_cost'},request:{...body,messages:body.messages}};
}
