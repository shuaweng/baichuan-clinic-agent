// Offline integrity verification: never invokes either model.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,locations,read,hash,fields,validateReview,validateClusters,aggregate} from '../runtime/review/core.mjs';
import {signals} from '../runtime/jev/dashboard/shared.mjs';
const loc=locations('physician-100');
const jsonl=async name=>(await readFile(path.join(loc.data,name),'utf8')).trim().split('\n').map(JSON.parse);
const scenarios=await jsonl('scenarios.jsonl'),sessions=await jsonl('sessions.jsonl');
const inputs=await read(path.join(loc.data,'evaluation-inputs.json'));
const labels=await jsonl('jev-labels.jsonl');
assert.equal(sessions.length,100);assert.equal(new Set(sessions.map(s=>s.session_id)).size,100);
assert.equal(inputs.length,251);assert.equal(labels.length,251);
const distribution={};
for(const session of sessions){
 const scenario=scenarios.find(s=>s.scenario_id===session.scenario_id);
 assert.equal(session.status,'completed');assert.equal(session.turns.length,scenario.turns.length);
 distribution[session.turns.length]=(distribution[session.turns.length]??0)+1;
 session.turns.forEach((t,i)=>assert.equal(t.query,scenario.turns[i].user));
}
assert.deepEqual(distribution,{'1':39,'2':33,'3':8,'4':9,'6':6,'10':5});
for(const row of labels){
 const input=inputs.find(i=>i.id===row.id);
 assert.equal(row.query,input.current.query.text);assert.equal(row.answer,input.current.answer.text);
 const request=await read(path.join(loc.local,'jev-results-v1',row.id+'.request.json'));
 const result=await read(path.join(loc.local,'jev-results-v1',row.id+'.result.json'));
 assert.equal(hash(request),result.input_sha256);assert.equal(result.input_sha256,row.evaluation_input_sha256);
 assert.deepEqual(Object.keys(result.answers).sort(),[...fields].sort());assert.deepEqual(result.answers,row.answers);
 assert.deepEqual(request.state.history,input.history);
 if(result.composition){
  const actual={};
  for(const [index,part]of result.composition.parts.entries()){
   const base=path.join(loc.local,'jev-results-v1',row.id+'.part-'+index);
   const sent=await read(base+'.request.json'),received=await read(base+'.result.json');
   assert.deepEqual(sent.state,request.state);assert.equal(hash(sent),received.input_sha256);assert.equal(part.input_sha256,received.input_sha256);
   Object.assign(actual,received.answers);
  }
  assert.deepEqual(actual,result.answers);
 }
}
const ds=await read(path.join(loc.data,'ds-review.json'));
assert.equal(ds.status,'completed');assert.equal(ds.failed,0);assert.equal(ds.completed,ds.total);
assert.equal(new Set(ds.records.map(r=>r.qa_id)).size,ds.total);
const selected=labels.filter(row=>{
 const signal=signals(row.answers);
 return signal.queues.some(q=>['badcase_candidate','uncertain','missing_evidence'].includes(q))||parseInt(hash(row.id).slice(0,4),16)%10===0;
});
assert.deepEqual(ds.records.map(r=>r.qa_id).sort(),selected.map(r=>r.id).sort());
for(const record of ds.records){
 const request=await read(path.join(loc.review,record.qa_id+'.request.json'));
 validateReview(record,request.input);
 assert.equal(record.input_sha256,hash({system:request.system,input:request.input,model:'deepseek-flash',version:record.version}));
 const row=labels.find(r=>r.id===record.qa_id);
 assert.equal(request.input.state.current.query.text,row.query);assert.equal(request.input.state.current.answer.text,row.answer);
}
const findings=ds.records.flatMap(r=>r.findings).filter(f=>f.verdict!=='refuted');
validateClusters({clusters:ds.clusters},findings);
assert.deepEqual(aggregate(ds.clusters,findings).map(c=>c.id),ds.clusters.map(c=>c.id));
const summary={sessions:sessions.length,turns:inputs.length,distribution,jev_judgments:labels.length*fields.length,jev_candidate_qa:labels.filter(r=>r.candidate_fields.length).length,deepseek_reviewed:ds.completed,findings:findings.length,clusters:ds.clusters.length,verdicts:findings.reduce((a,f)=>(a[f.verdict]=(a[f.verdict]??0)+1,a),{}),severity:findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]??0)+1,a),{})};
console.log(JSON.stringify(summary,null,2));
