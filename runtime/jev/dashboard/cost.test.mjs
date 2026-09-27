import test from 'node:test';
import assert from 'node:assert/strict';
import {metrics} from './shared.mjs';

const item=(usage,requestCount=1)=>({evaluationModes:['qa'],modes:{qa:{status:'completed',result:{answers:{},usage,requestCount,cost:0}}}});

test('input-price estimate keeps zero billing intact and counts aggregate split usage once',()=>{
 const summary=metrics([item({inputTokens:1_000_000,outputTokens:800,totalTokens:1_000_800},4),item({inputTokens:500_000})]);
 assert.equal(summary.estimatedCost,.06);
 assert.equal(summary.inputTokens,1_500_000);
 assert.equal(summary.requests,5);
 assert.equal(summary.cost,0);
});

test('missing or invalid input usage cannot silently produce an understated total',()=>{
 for(const usage of [undefined,{}, {inputTokens:null},{inputTokens:-1},{inputTokens:NaN},{inputTokens:Infinity},{inputTokens:'100'}]){
  const summary=metrics([item({inputTokens:100}),item(usage)]);
  assert.equal(summary.estimatedCost,null);
  assert.equal(summary.inputTokens,null);
 }
 assert.equal(metrics([]).estimatedCost,0);
 assert.equal(metrics([item({inputTokens:0})]).estimatedCost,0);
});
