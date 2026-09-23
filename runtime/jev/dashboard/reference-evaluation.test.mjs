import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest} from '../evaluate.mjs';
import {QA_QUESTIONS_V2,V2_FIELDS,QUESTION_VERSION_V2} from '../questions-v2.mjs';
import {signals,matchesDistribution} from './shared.mjs';
const input={evaluation_profile:'medical-reference-v2',product_contract:{evaluation_profile:'medical-reference-v2',service_scope:['儿科'],capability_snapshot:{text_assistance:'configured'}},current:{turn_id:1,query:{text:'孩子的问题'},answer:{text:'DSH 生成的回答'},completion:{kind:'completed'}},reference_material:{question:'孩子的问题',answer:'公开配对答案',trust:'unreviewed_reference'},history:[],execution:{}};
const choice=value=>({type:'choice',choice:value,probabilities:{[value]:.9,other:.1}});
test('reference only enters answer evaluation and does not replace DSH answer',()=>{
 const query=buildRequest(input,'query'),qa=buildRequest(input,'qa');
 assert.equal(query.state.reference_material,undefined);assert.equal(query.state.current.answer,undefined);
 assert.equal(qa.state.current.answer.text,'DSH 生成的回答');assert.equal(qa.state.reference_material.answer,'公开配对答案');
 assert.equal(Object.keys(query.questions).length,3);assert.equal(Object.keys(qa.questions).length,9);assert.equal(V2_FIELDS.length,12);
 assert.ok(Object.values(QA_QUESTIONS_V2).every(q=>q.instructions.includes('不是指南或标准答案')));
 assert.throws(()=>buildRequest({...input,reference_material:undefined}),/参考/);
});
test('medical risk and experience defects are badcases even when in scope and configured',()=>{
 const base={service_scope:choice('in_scope'),capability_coverage:choice('configured'),response_coverage:choice('addressed')};
 for(const [field,value,queue] of [['clinical_correctness','suspected_error','medical_risk'],['medication_safety','risk_detected','medical_risk'],['triage_safety','risk_detected','medical_risk'],['instruction_following','violated','experience_issue'],['actionability','poor_actionability','experience_issue'],['communication_quality','poor_communication','experience_issue'],['information_burden','overloaded','experience_issue']]){
  const answers={...base,[field]:choice(value)};assert.ok(signals(answers).queues.includes('badcase_candidate'));assert.ok(signals(answers).queues.includes(queue));
  assert.equal(matchesDistribution({modes:{qa:{result:{answers}}}},{queue}),true);
 }
});
test('reference conflict and missing evidence are not automatically medical errors',()=>{
 for(const value of ['reference_conflict','reference_insufficient','acceptable_difference'])assert.ok(!signals({reference_alignment:choice(value)}).queues.includes('badcase_candidate'));
 assert.ok(signals({clinical_correctness:choice('insufficient_evidence')}).queues.includes('missing_evidence'));
 assert.ok(!signals({clinical_correctness:choice('no_issue_detected')}).queues.includes('medical_risk'));
});
test('public dataset has fifty distinct sourced single-turn DSH sessions and twelve judgments each',async()=>{
 const {loadDataset}=await import('./server.mjs');const {createHash}=await import('node:crypto');
 const dataset=await loadDataset('public-medical-v2');assert.equal(dataset.rows.length,50);assert.equal(new Set(dataset.rows.map(r=>r.session_id)).size,50);
 assert.equal(dataset.history.questionVersion,QUESTION_VERSION_V2);
 for(const row of dataset.rows){
  assert.equal(row.previous_turns.length,0);assert.equal(row.reference_material.question,row.query);assert.match(row.reference_material.source_commit,/^[a-f0-9]{40}$/);
  const item=dataset.history.items.find(i=>i.rowId===row.id);
  for(const mode of ['query','qa']){
   const request=buildRequest(dataset.states.get(row.id),mode);
   const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
   assert.equal(item.modes[mode].result.inputSha256,hash);assert.equal(item.modes[mode].result.questionVersion,QUESTION_VERSION_V2);
   assert.equal(Object.keys(item.modes[mode].result.answers).length,mode==='query'?3:9);
  }
 }
});
