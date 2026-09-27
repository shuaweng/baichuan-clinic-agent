import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {runEvaluation,formatEvaluationError,MODEL} from './evaluate.mjs';
import {providerDuration} from './dashboard/shared.mjs';
import {evaluateInParts} from './split-evaluation.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const LARGE=process.env.PHYSICIAN_DATASET==='physician-100';
const DATA=path.join(ROOT,LARGE?'data/physician-tasks-100':'data/physician-tasks-50');
const LOCAL=path.join(ROOT,LARGE?'.local/physician-tasks-100-v1':'.local/physician-tasks-50-kb-v1');
const OUT=path.join(LOCAL,'jev-results-v1');
export const VERSION='physician-qa-1.0-pilot';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const writeText=async(p,t)=>{const tmp=p+'.tmp';await writeFile(tmp,t,{mode:0o600});await rename(tmp,p);};
const save=async(p,v)=>writeText(p,JSON.stringify(v,null,2)+'\n');
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
const number=v=>v===undefined||v===null?null:Number(v);
export function questionsFrom(rubric){return Object.fromEntries(Object.entries(rubric.questions).map(([k,v])=>[k,{...v.question,instructions:v.question.instructions+'\n适用条件：'+v.when+'。不适用时选择 not_applicable（如本题提供此选项）。'}]));}
export function prepareState(row,prior,events){
 const sources=new Map(),documents=new Map();
 const prune=value=>{
  if(Array.isArray(value))return value.map(prune);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const [k,v] of Object.entries(value)){
   if(['notice','citation','license','license_url','next_step'].includes(k))continue;
   if(k==='source'&&v?.id){sources.set(v.id,pick(v,['id','title','title_zh','publisher','url','version','source_type','population','jurisdiction','limitations','source_sha256','clinically_reviewed']));result.source_id=v.id;}
   else if(k==='sources'&&Array.isArray(v)){result.source_ids=v.map(s=>{sources.set(s.id,pick(s,['id','title','title_zh','publisher','url','version','source_type','population','jurisdiction','limitations','source_sha256','clinically_reviewed']));return s.id;});}
   else result[k]=prune(v);
  }
  return result;
 };
 const calls=new Map();
 for(const event of events){
  if(event.seq>row.provenance.end_event_seq)continue;
  if(event.type!=='assistant/message')continue;
  for(const b of event.data?.message?.content??[])if(b.type==='tool-call'){
   let args=b.arguments;try{args=JSON.parse(args);}catch{}
   calls.set(b.id,{name:b.name,arguments:args});
  }
 }
 const toolResults=[];
 for(const turn of [...prior,row]){
  for(const doc of turn.evidence.read_chunks??[])documents.set(doc.id,prune(doc));
  for(const event of turn.execution.tool_results){
   const d=event.data,callId=d.message.source.callId;
   const blocks=d.message.content.filter(b=>b.type==='tool-result');
   let output=d.meta;
   if(!output)output=blocks.flatMap(b=>b.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
   toolResults.push({event_seq:event.seq,turn_id:turn.id,call_id:callId,...calls.get(callId),is_error:blocks.some(b=>b.isError===true),result:prune(output)});
  }
 }
 // Read results and document evidence share exactly one payload.
 for(const tool of toolResults)if(tool.name==='medical_kb_read'&&documents.has(tool.result?.id))tool.result={read_document_id:tool.result.id};
 const checks=[];
 if(row.id.startsWith('D025'))checks.push({kind:'arithmetic_only',expression:row.id.endsWith('-1')?'60 mg / (20 mg/mL)':'60 mg / (40 mg/mL)',expected:row.id.endsWith('-1')?3:1.5,unit:'mL',clinical_suitability:'not_assessed_fictional_teaching_exercise'});
 if(row.id.startsWith('D043'))checks.push({kind:'arithmetic_only',august:{review_coverage:90/100,reviewed_completeness:80/90},september:{review_coverage:100/120,reviewed_completeness:90/100},significance:'not_tested',unreviewed_records:'unknown'});
 const docs=[...documents.values()];
 const bindings=(row.current.answer.segments??[]).flatMap(s=>docs.filter(d=>s.text.includes(sources.get(d.source_id)?.url??'__no_url__')).map(d=>({answer_segment_id:s.id,document_id:d.id,match:'exact_source_url_in_same_segment_only',semantic_support:'not_checked'})));
 const state={current:row.current,history:row.history,context_selection:{history_truncated:false,includes_previous_turn_tool_evidence:true,excluded:['internal_reasoning','duplicate_tool_payloads'],tool_results_retained:toolResults.length},task_contract:row.task_contract,clinic_context:{status:'not_provided_to_this_request'},execution:{tool_results:toolResults,turn_log_complete:row.execution.turn_log_complete,evidence_cutoff:row.provenance.end_event_seq},evidence:{origin:'actual_dsh_tool_results',independent_clinical_review:false,documents:docs,sources:[...sources.values()],limitations:'检索摘要不是全文；本库是有限摘录。缺少医学依据时不可判定已验证正确。'},claim_evidence:{bindings,binding_limit:'仅精确网址绑定，不证明语义支持；其余绑定未建立。'},calculation_checks:checks,provenance:row.provenance};
 const forbidden=new Set(['reasoning','reasoning_content','api_key','apiKey','authorization','cookie','gold_label']);
 function inspect(v){if(Array.isArray(v))v.forEach(inspect);else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){if(forbidden.has(k))throw Error('Forbidden state field: '+k);inspect(x);}}
 inspect(state);return state;
}
export function candidateFields(answers){return Object.entries(answers).filter(([k,v])=>v.choice==='issue_detected'||['partial','off_target','major_rework','unusable','unsupported_claim','partial_support','contradicted','irrelevant'].includes(v.choice)).map(([k])=>k);}
export function compactLargeRequest(request){
 if(Buffer.byteLength(JSON.stringify(request))<=90000)return request;
 const out=structuredClone(request);
 for(const tool of out.state.execution.tool_results){
  if(tool.name==='medical_kb_search'&&tool.result&&typeof tool.result==='object'){
   tool.result={...pick(tool.result,['corpus_version','returned_count','not_found']),results:(tool.result.results??[]).map(r=>pick(r,['id','source_id','retrieval_score'])),search_snippets_omitted:true};
  }
 }
 for(const segment of out.state.current.answer.segments??[])delete segment.text;
 out.state.context_selection={...out.state.context_selection,search_snippets_omitted:true,answer_segment_text_omitted_as_duplicate:true,history_truncated:false,read_documents_truncated:false};
 return out;
}
export function compactOversizedRequest(request){
 if(Buffer.byteLength(JSON.stringify(request))<=100000)return request;
 const out=structuredClone(request),s=out.state;
 // Keep all clinical text; remove redundant indexing/display metadata only.
 delete s.current.answer.segments;delete s.provenance;delete s.claim_evidence;
 for(const d of s.evidence.documents)for(const key of ['corpus_version','text_sha256','source_presence','caution','semantic_support'])delete d[key];
 for(const source of s.evidence.sources)delete source.source_sha256;
 for(const tool of s.execution.tool_results){
  delete tool.call_id;
  if(tool.name==='medical_kb_search')tool.result={returned_ids:tool.result.results.map(r=>r.id),not_found:tool.result.not_found,search_snippets_omitted:true};
 }
 s.context_selection.redundant_index_metadata_omitted=true;
 return out;
}
export async function main(){
 const {values}=parseArgs({options:{'dry-run':{type:'boolean'},limit:{type:'string'},'export-only':{type:'boolean'}}});
 const inputs=await read(path.join(DATA,'evaluation-inputs.json')),rubric=await read(path.join(ROOT,'config/jev-physician-rubric.v1.json'));
 const questions=questionsFrom(rubric);
 await mkdir(OUT,{recursive:true});
 const contract={question_version:VERSION,status:'pilot_not_clinically_calibrated',policy:rubric.policy,field_metadata:Object.fromEntries(Object.entries(rubric.questions).map(([k,v])=>[k,pick(v,['label','group','when'])])),product_contract:{service_scope:['面向医生与诊室团队的妇科、儿科和办公辅助'],response_expectations:[rubric.common_instructions,'判断依据仅含给定输入、实际工具返回与有限检索摘录；无外部专家金标准。'],capability_snapshot:{text_assistance:'configured',medical_knowledge_retrieval:'有限本地 WHO/CDC 摘录；本轮检索记录见原始请求',hospital_record_access:'not_integrated',appointment_or_reminder_execution:'not_integrated'}},questions:{qa:questions}};
 await save(path.join(DATA,'jev-evaluation-contract.json'),contract);
 const prepared=[];
 for(const row of inputs){
  const prior=inputs.filter(r=>r.session_id===row.session_id&&r.provenance.end_event_seq<row.provenance.end_event_seq);
  const events=await read(path.join(LOCAL,'events',row.id.split('-turn-')[0]+'.json'));
  const fullRequest={model:MODEL,state:prepareState(row,prior,events),questions};const standardRequest=LARGE?compactLargeRequest(fullRequest):fullRequest;let request=LARGE?compactOversizedRequest(standardRequest):standardRequest;
  if(request!==fullRequest){const originalPath=path.join(OUT,row.id+'.precompact.request.json');try{await read(originalPath);}catch(e){if(e.code!=='ENOENT')throw e;await save(originalPath,fullRequest);}}
  prepared.push({row,request});const requestPath=path.join(OUT,row.id+'.request.json');
  try{const frozen=await read(requestPath);if(hash(frozen)!==hash(request)){
    if(hash(frozen)!==hash(fullRequest)&&hash(frozen)!==hash(standardRequest))throw Error('Frozen request differs; use a new version: '+row.id);
    let scored=false;try{await read(path.join(OUT,row.id+'.result.json'));scored=true;}catch(e){if(e.code!=='ENOENT')throw e;}
    if(scored){request=frozen;prepared.at(-1).request=frozen;}else{await save(path.join(OUT,row.id+'.prebudget.request.json'),frozen);await save(requestPath,request);}
   }}catch(e){if(e.code!=='ENOENT')throw e;await save(requestPath,request);}
 }
 console.log(JSON.stringify({prepared:prepared.length,questions_per_request:Object.keys(questions).length,max_state_characters:Math.max(...prepared.map(p=>JSON.stringify(p.request.state).length))}));
 if(values['dry-run'])return;
 if(!values['export-only']&&!process.env.AI_GATEWAY_API_KEY?.trim())throw Error('缺少 AI_GATEWAY_API_KEY');
 let attempted=0,reserved=0,nextLaunch=0,launchQueue=Promise.resolve();
 const launchSlot=()=>{const ready=launchQueue.then(async()=>{const delay=Math.max(0,nextLaunch-Date.now());if(delay)await new Promise(r=>setTimeout(r,delay));nextLaunch=Date.now()+3000;});launchQueue=ready;return ready;};
 const processOne=async({row,request})=>{
  const dest=path.join(OUT,row.id+'.result.json');
  try{const existing=await read(dest);if(existing.status==='evaluated'&&existing.input_sha256===hash(request))return;throw Error('Existing result hash mismatch: '+row.id);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(values['export-only']||reserved>=Number(values.limit??Infinity))return;reserved++;
  const start=Date.now();
  try{
   let result;
   for(let attempt=1;attempt<=3;attempt++){
    await launchSlot();const attemptStart=Date.now();
    try{result=await runEvaluation(request);result.duration_ms=Date.now()-attemptStart;break;}
    catch(error){
     const status=error?.statusCode??error?.cause?.statusCode;
     await save(path.join(OUT,row.id+'.attempt-'+Date.now()+'.error.json'),{attempt,status,message:formatEvaluationError(error),duration_ms:Date.now()-attemptStart});
     if((![429,502,503,504].includes(status)&&!['AI_InvalidResponseDataError','AI_TypeValidationError','AI_NoObjectGeneratedError','TimeoutError','AbortError'].includes(error?.name))||attempt===3){
      if(status!==503||attempt!==3)throw error;
      result=await evaluateInParts(request,async(part,index)=>{
       const partPath=path.join(OUT,row.id+'.part-'+index);
       try{const cached=await read(partPath+'.result.json');if(cached.input_sha256!==hash(part))throw Error('Part input mismatch');return cached;}catch(e){if(e.code!=='ENOENT')throw e;}
       await save(partPath+'.request.json',part);
       for(let retry=0;retry<3;retry++){await launchSlot();const began=Date.now();try{const scored=await runEvaluation(part);scored.duration_ms=Date.now()-began;await save(partPath+'.result.json',scored);return scored;}catch(e){await save(partPath+'.attempt-'+Date.now()+'.error.json',{status:e.statusCode??e.cause?.statusCode,duration_ms:Date.now()-began,message:formatEvaluationError(e)});if(retry===2||![429,502,503,504].includes(e.statusCode??e.cause?.statusCode))throw e;await new Promise(r=>setTimeout(r,5000));}}
      });
      console.log(JSON.stringify({id:row.id,status:'evaluated_in_parts',requests:result.composition.request_count}));break;
     }
     console.log(JSON.stringify({id:row.id,retry:attempt,status}));
     await new Promise(resolve=>setTimeout(resolve,status===429?20000:attempt*4000));
    }
   }
   result.question_version=VERSION;result.total_elapsed_ms=Date.now()-start;
   if(Object.keys(result.answers).length!==Object.keys(questions).length)throw Error('Incomplete model judgments');
   await save(dest,result);attempted++;
   console.log(JSON.stringify({id:row.id,status:'evaluated',duration_ms:result.duration_ms,candidates:candidateFields(result.answers),cost:result.gateway?.cost}));
  }catch(e){await save(path.join(OUT,row.id+'.error.json'),{at:new Date().toISOString(),message:formatEvaluationError(e)});console.log(JSON.stringify({id:row.id,status:'failed',message:formatEvaluationError(e)}));if([401,402,403].includes(e?.statusCode??e?.cause?.statusCode))throw e;}
  await new Promise(resolve=>setTimeout(resolve,1100));
 };
 let cursor=0;await Promise.all(Array.from({length:Math.max(1,Math.min(3,Number(process.env.JEV_WORKERS??1)))},async()=>{for(;;){const entry=prepared[cursor++];if(!entry)break;await processOne(entry);}}));
 const labels=[],items=[];
 for(const {row,request} of prepared){
  let result;try{result=await read(path.join(OUT,row.id+'.result.json'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(result.input_sha256!==hash(request))throw Error('Input mismatch: '+row.id);
  const fields=candidateFields(result.answers);
  labels.push({id:row.id,title:row.task_contract.task_type,scenario_id:row.id.split('-turn-')[0],sampling_group:({'baichuan-gynecology':'妇科','baichuan-pediatrics':'儿科','baichuan-office':'办公模式'})[row.agent_preset]??row.agent_preset,session_id:row.session_id,turn_id:Number(row.id.split('-turn-')[1]),query:row.current.query.text,answer:row.current.answer.text,previous_turns:row.history,agent_preset:row.agent_preset,provenance:row.provenance,answers:result.answers,candidate_fields:fields,question_version:VERSION,evaluation_input_sha256:result.input_sha256});
  items.push({rowId:row.id,evaluationModes:['qa'],modes:{qa:{status:'completed',result:{answers:result.answers,requestCount:result.composition?.request_count??1,durationMs:result.duration_ms,providerDurationMs:providerDuration(result.gateway),evaluatedAt:result.evaluated_at,cost:number(result.gateway?.cost),marketCost:number(result.gateway?.marketCost),usage:result.usage,questionVersion:VERSION,inputSha256:result.input_sha256}}}});
 }
 const results=items.map(i=>i.modes.qa.result),allCost=results.map(r=>r.cost),bad=labels.filter(r=>r.candidate_fields.length);
 const summary={question_version:VERSION,evaluated_qa:labels.length,total_qa:inputs.length,judgments:labels.length*Object.keys(questions).length,candidate_qa:bad.length,candidates:bad.map(r=>({id:r.id,fields:r.candidate_fields})),field_distribution:Object.fromEntries(Object.keys(questions).map(f=>[f,labels.reduce((a,r)=>{const c=r.answers[f].choice;a[c]=(a[c]??0)+1;return a;},{})])),cost_usd:allCost.length&&allCost.every(Number.isFinite)?allCost.reduce((a,b)=>a+b,0):null,expert_reviewed:false};
 await writeText(path.join(DATA,'jev-labels.jsonl'),labels.map(r=>JSON.stringify(r)).join('\n')+'\n');
 await save(path.join(DATA,'jev-summary.json'),summary);
 await save(path.join(DATA,'jev-timeline.json'),{id:LARGE?'physician-100-v1':'physician-pilot-v1',name:'医生场景 · '+new Set(labels.map(r=>r.session_id)).size+' 个 Session',status:labels.length===inputs.length?'completed':'completed_with_errors',kind:'history',startedAt:results[0]?.evaluatedAt,endedAt:results.at(-1)?.evaluatedAt,questionVersion:VERSION,durationBasis:'successful_provider_attempts',items});
 const lines=['# 医生场景 JEV 评估结果','',`${labels.length}/${inputs.length} 条真实 DSH QA，${summary.judgments} 个判断；${bad.length} 条问题候选。费用：${summary.cost_usd===null?'未知':'$'+summary.cost_usd.toFixed(6)}。`,'','问题为医生任务合成场景；答案来自实际 DSH。候选按独立维度的模型分类汇总，未做临床专家确认或阈值校准；证据不足不计作通过。JEV 不生成文字理由。','', '| QA | JEV 问题候选维度 |','|---|---|',...bad.map(r=>`| ${r.id} | ${r.candidate_fields.map(f=>rubric.questions[f].label+' '+Math.round(r.answers[f].probabilities[r.answers[f].choice]*100)+'%').join('、')} |`),'','## 各维度分布','',...Object.entries(summary.field_distribution).map(([f,counts])=>`- ${rubric.questions[f].label}：${JSON.stringify(counts)}`),'','原始请求和响应：`'+path.relative(ROOT,OUT)+'/`；当前与历史工具证据均保留，内部推理未发送。'];
 await writeFile(path.join(DATA,'jev-report.md'),lines.join('\n')+'\n');
 if(labels.length===inputs.length){for(const filename of ['manifest.json','collection-status.json']){const v=await read(path.join(DATA,filename));v.evaluation_status='evaluated_pilot_not_clinically_reviewed';v.evaluated_turns=labels.length;v.question_version=VERSION;await save(path.join(DATA,filename),v);}}
 console.log(JSON.stringify(summary));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(e=>{console.error(formatEvaluationError(e));process.exitCode=1;});
