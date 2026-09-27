import test from 'node:test';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{evaluateInParts}from'./split-evaluation.mjs';
test('split requests preserve full context and sum actual costs, tokens and request count',async()=>{
 const request={model:'test',state:{history:['unchanged clinical context']},questions:Object.fromEntries(Array.from({length:14},(_,i)=>['q'+i,{type:'choice'}]))};let calls=0;
 const result=await evaluateInParts(request,async part=>{calls++;assert.deepEqual(part.state,request.state);return{answers:Object.fromEntries(Object.keys(part.questions).map(k=>[k,{choice:'unknown'}])),input_sha256:createHash('sha256').update(JSON.stringify(part)).digest('hex'),evaluated_at:'2026-09-24',duration_ms:10,usage:{inputTokens:100,outputTokens:5,totalTokens:105},gateway:{cost:'0.001',routing:{modelAttempts:[]}}};});
 assert.equal(calls,4);assert.equal(result.composition.request_count,4);assert.equal(Object.keys(result.answers).length,14);assert.equal(result.usage.totalTokens,420);assert.equal(result.gateway.cost,'0.004');assert.equal(result.duration_ms,40);
 await assert.rejects(evaluateInParts(request,async()=>({input_sha256:'wrong',answers:{}})),/mismatch/);
});
