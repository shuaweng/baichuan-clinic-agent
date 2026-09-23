import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadDataset,createDashboardServer} from './server.mjs';
import {buildRequest} from '../evaluate.mjs';
import {V3_FIELDS} from '../questions-v3.mjs';
import {metrics,signals,answersOf} from './shared.mjs';
import {EvaluationRunner} from './runner.mjs';
const choice=c=>({type:'choice',choice:c,probabilities:{[c]:.95,other:.05}});
test('v3 preserves all actual QA and freezes exact scored inputs without leaking editorial conclusions',async()=>{
 const old=await loadDataset('public-medical-v2'),now=await loadDataset('public-medical');
 assert.equal(now.rows.length,50);assert.equal(metrics(now.history.items).requests,100);assert.equal(metrics(now.history.items).judgments,50*V3_FIELDS.length);
 for(const row of now.rows){
  const before=old.rows.find(r=>r.id===row.id);assert.equal(row.query,before.query);assert.equal(row.answer,before.answer);assert.equal(row.session_id,before.session_id);
  const state=now.states.get(row.id),query=buildRequest(state,'query'),qa=buildRequest(state,'qa');
  assert.equal(query.state.review_focus,undefined);assert.equal(query.state.clinical_evidence,undefined);assert.equal(query.state.reference_material,undefined);
  for(const f of qa.state.review_focus){assert.ok(row.answer.includes(f.quote));assert.equal(f.impact,undefined);assert.equal(f.improvement,undefined);}
  for(const mode of ['query','qa'])assert.equal(createHash('sha256').update(JSON.stringify(buildRequest(state,mode))).digest('hex'),now.history.items.find(i=>i.rowId===row.id).modes[mode].result.inputSha256);
 }
 assert.equal(now.rows.filter(r=>r.clinical_evidence.length).length,4);assert.equal(metrics(old.history.items).badcases,0);
});
test('atomic defects create candidates; absent or inconclusive evidence cannot become a clinical pass or badcase',()=>{
 for(const [field,value] of [['factual_grounding','unsupported_fact'],['followup_burden','excessive_followup'],['evidence_consistency','evidence_conflict']])assert.ok(signals({[field]:choice(value)}).queues.includes('badcase_candidate'));
 const excluded={ignoredFields:['evidence_consistency'],modes:{qa:{result:{answers:{evidence_consistency:choice('evidence_conflict')}}}}};
 assert.equal(answersOf(excluded).evidence_consistency.choice,'evidence_conflict');assert.ok(!signals(answersOf(excluded)).queues.includes('badcase_candidate'));
 for(const value of ['evidence_supported','evidence_unclear','not_checked'])assert.ok(!signals({evidence_consistency:choice(value)}).queues.includes('badcase_candidate'));
});
test('same QA id resolves the correct frozen rules in each version',async t=>{
 const old=await loadDataset('public-medical-v2'),now=await loadDataset('public-medical');
 const directory=await mkdtemp(path.join(tmpdir(),'jev-audit-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const runner=new EvaluationRunner({directory,states:now.states,evaluate:async()=>{throw new Error('Test must not call a model');}});await runner.init();
 const server=createDashboardServer({dataset:now,datasets:[old,now],runner,apiConfigured:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const base='http://127.0.0.1:'+server.address().port;
 for(const dataset of [old,now]){
  const rules=await (await fetch(base+'/api/rules?'+new URLSearchParams({rowId:'CMD017-turn-1',runId:dataset.history.id}))).json();assert.equal(rules.questionVersion,dataset.contract.question_version);
  assert.equal(Object.keys(rules.questions.qa).length,dataset===now?12:9);
  if(dataset===now){assert.equal(rules.clinicalEvidence.length,1);assert.equal(rules.reviewFocus[0].impact,undefined);}
 }
 const archive=await (await fetch(base+'/api/bootstrap?dataset=public-medical-v2')).json();assert.equal(archive.liveEligibleIds.length,0);
});
