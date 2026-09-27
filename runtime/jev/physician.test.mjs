import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareState,questionsFrom,candidateFields} from './evaluate-physician-batch.mjs';
import {signals,itemStatus,itemProviderDuration,metrics} from './dashboard/shared.mjs';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
test('physician inputs preserve answers, prior evidence and tool arguments, excluding private reasoning',async()=>{
 const rows=await read('../../data/physician-tasks-50/evaluation-inputs.json');
 const row=rows.find(r=>r.id==='D009-turn-2'),prior=rows.filter(r=>r.session_id===row.session_id&&r.id!==row.id);
 const events=await read('../../.local/physician-tasks-50-kb-v1/events/D009.json');
 const state=prepareState(row,prior,events);
 assert.deepEqual(state.current,row.current);assert.deepEqual(state.history,row.history);
 assert.ok(state.evidence.documents.length>0);assert.ok(state.execution.tool_results.some(t=>t.name==='medical_kb_read'));
 assert.equal(state.execution.tool_results.length,[...prior,row].reduce((n,r)=>n+r.execution.tool_results.length,0));
 assert.ok(!JSON.stringify(state).includes('"reasoning"'));assert.ok(state.evidence.documents.every(d=>d.text));
 const rubric=await read('../../config/jev-physician-rubric.v1.json');const questions=questionsFrom(rubric);
 assert.equal(Object.keys(questions).length,14);assert.ok(Object.values(questions).every(q=>q.instructions.includes('适用条件：')));
});
const choice=c=>({type:'choice',choice:c,probabilities:{[c]:.9,other:.1}});
test('physician candidates do not turn unknown medical correctness into a pass or a badcase',()=>{
 const base={task_completion:choice('completed'),medical_correctness:choice('insufficient_evidence')};
 assert.deepEqual(candidateFields(base),[]);assert.deepEqual(signals(base).queues,['missing_evidence']);
 for(const [field,value] of [['case_fidelity','issue_detected'],['urgent_management','issue_detected'],['deliverable_usability','major_rework'],['execution_honesty','unsupported_claim'],['citation_support','partial_support']]){
  const answers={...base,[field]:choice(value)};
  assert.deepEqual(candidateFields(answers),[field]);assert.ok(signals(answers).queues.includes('badcase_candidate'));
 }
});
test('one real physician request counts as completed without inventing a second request',()=>{
 const item={evaluationModes:['qa'],modes:{qa:{status:'completed',result:{answers:{task_completion:choice('completed')},providerDurationMs:123,cost:0,usage:{totalTokens:25}}}}};
 assert.equal(itemStatus(item),'completed');assert.equal(itemProviderDuration(item),123);
 const stats=metrics([item]);assert.equal(stats.requests,1);assert.equal(stats.completed,1);assert.equal(stats.judgments,1);
});

test('large context compaction keeps full QA, history and read evidence',async()=>{
 const {compactLargeRequest}=await import('./evaluate-physician-batch.mjs');
 const original=await read('../../.local/physician-tasks-100-v1/jev-results-v1/D066-turn-5.request.json');
 const compact=compactLargeRequest(original);
 assert.equal(compact.state.current.answer.text,original.state.current.answer.text);
 assert.deepEqual(compact.state.history,original.state.history);assert.deepEqual(compact.state.evidence.documents,original.state.evidence.documents);
 assert.equal(compact.state.execution.tool_results.length,original.state.execution.tool_results.length);
 assert.ok(Buffer.byteLength(JSON.stringify(compact))<90000);
});
test('oversized ten-turn context loses only redundant metadata and keeps every medical text',async()=>{
 const {compactOversizedRequest}=await import('./evaluate-physician-batch.mjs');
 const original=await read('../../.local/physician-tasks-100-v1/jev-results-v1/D088-turn-10.prebudget.request.json');
 const compact=compactOversizedRequest(original);
 assert.deepEqual(compact.state.history,original.state.history);
 assert.equal(compact.state.current.query.text,original.state.current.query.text);
 assert.equal(compact.state.current.answer.text,original.state.current.answer.text);
 assert.deepEqual(compact.state.evidence.documents.map(d=>d.text),original.state.evidence.documents.map(d=>d.text));
 assert.deepEqual(compact.state.execution.tool_results.map(t=>t.arguments),original.state.execution.tool_results.map(t=>t.arguments));
 assert.ok(Buffer.byteLength(JSON.stringify(compact))<Buffer.byteLength(JSON.stringify(original)));
});
test('grouped evaluation counts its real requests without duplicating the QA or judgments',()=>{
 const stats=metrics([{evaluationModes:['qa'],modes:{qa:{status:'completed',result:{requestCount:4,answers:{task_completion:choice('completed')},cost:0,providerDurationMs:800,usage:{totalTokens:100}}}}}]);
 assert.equal(stats.completed,1);assert.equal(stats.requests,4);assert.equal(stats.judgments,1);assert.equal(stats.costKnown,4);assert.equal(stats.providerDurationKnown,4);assert.equal(stats.providerDurationMs,800);
});
