import test from 'node:test';import assert from 'node:assert/strict';
import {fields,buildInput,validateReview,validateClusters,clusterInput,normalizeClusters,aggregate,callModel} from './core.mjs';
const input=buildInput({state:{current:{query:{text:'年份未给'},answer:{text:'2024',segments:[{id:'p1',text:'2024'}]}},history:[],provenance:{model:'secret'}}});
const finding={dimension:'case_fidelity',verdict:'supported',kind:'answer_defect',severity:'P1',title:'补出年份',explanation:'原问题没有年',impact:'误写摘要',next_action:'核对原文',missing_evidence:[],requires_clinician:false,evidence:[{source_id:'p1',quote:'2024'}]};
test('only exact source quotes are accepted; model identity is excluded',()=>{assert.equal(input.state.provenance,undefined);const v={assessments:[],summary:'test',checked_dimensions:fields,findings:[finding]};assert.equal(validateReview(v,input),v);assert.throws(()=>validateReview({...v,findings:[{...finding,evidence:[{source_id:'p1',quote:'2025'}]}]},input));});
test('clusters cannot invent members and severity is computed separately from certainty',()=>{const fs=[{...finding,id:'a',qa_id:'q',session_id:'s'},{...finding,id:'b',qa_id:'q2',session_id:'s',verdict:'inconclusive',severity:'P0'}];const c={title:'x',kind:'answer_defect',impact:'i',next_action:'n',why_read:'w',finding_ids:['a','b']};validateClusters({clusters:[c]},fs);const out=aggregate([c],fs)[0];assert.equal(out.severity,'P0');assert.equal(out.session_count,1);assert.equal(out.qa_count,2);assert.throws(()=>validateClusters({clusters:[{...c,finding_ids:['a','unknown']}]},fs));assert.throws(()=>validateClusters({clusters:[c,c]},fs));});
test('provider payload and persisted response never include credentials or hidden reasoning',async()=>{let headers;const result=await callModel('Return json',{}, {key:'fake-test-only',fetchImpl:async(url,opts)=>{headers=opts.headers;return{ok:true,json:async()=>({model:'deepseek-flash',id:'test',usage:{total_tokens:1},choices:[{finish_reason:'stop',message:{content:'{"ok":true}',reasoning_content:'HIDDEN'}}]})}}});assert.equal(headers.Authorization,'Bearer fake-test-only');assert.ok(!JSON.stringify(result).includes('HIDDEN'));assert.ok(!JSON.stringify(result).includes('fake-test-only'));});
test('cluster assignment maps restore only real IDs and reject missing, unknown or cross-kind members',()=>{
 const fs=[{...finding,id:'long-source-a'},{...finding,id:'long-source-b'}];
 const c={id:'C1',title:'t',kind:'answer_defect',impact:'i',next_action:'n',why_read:'w'};
 assert.deepEqual(clusterInput(fs).findings.map(f=>f.id),['F001','F002']);
 assert.deepEqual(normalizeClusters({clusters:[c],assignments:{F001:'C1',F002:'C1'}},fs).clusters[0].finding_ids,fs.map(f=>f.id));
 assert.throws(()=>normalizeClusters({clusters:[c],assignments:{F001:'C1'}},fs),/遗漏/);
 assert.throws(()=>normalizeClusters({clusters:[c],assignments:{F001:'C1',F002:'unknown'}},fs),/未知/);
 assert.throws(()=>normalizeClusters({clusters:[{...c,kind:'potential_need'}],assignments:{F001:'C1',F002:'C1'}},fs),/kind/);
});
