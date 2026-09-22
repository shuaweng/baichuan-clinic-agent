import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {EvaluationRunner} from './runner.mjs';
import {createDashboardServer,loadDataset} from './server.mjs';
import {metrics,signals,answersOf,providerDuration,itemProviderDuration,itemDuration} from './shared.mjs';
import {QUESTION_VERSION} from '../questions.mjs';

const sample={product_contract:{service_scope:['妇幼健康'],capability_snapshot:{text:'configured'}},current:{turn_id:1,query:{text:'帮我整理就诊问题'},answer:{text:'请记录主要症状与时间。'},completion:{kind:'completed'}},history:[],execution:{observation_status:'complete_for_closed_turn',tool_calls:[],tool_results:[]}};
const stateMap=()=>new Map([['S-test',structuredClone(sample)]]);
function localResult(request){
  const choice={service_scope:'in_scope',capability_coverage:'configured',response_coverage:'addressed',context_consistency:'consistent',execution_claim:'no_claim'};
  const answers=Object.fromEntries(Object.entries(request.questions).map(([key,q])=>[key,q.type==='boolean'?{type:'boolean',probability:.02}:{type:'choice',choice:choice[key],probabilities:Object.fromEntries(Object.keys(q.criteria).map(c=>[c,c===choice[key]?1:0]))}]));
  return {status:'evaluated',answers,evaluated_at:new Date().toISOString(),input_sha256:createHash('sha256').update(JSON.stringify(request)).digest('hex'),question_version:QUESTION_VERSION,usage:{inputTokens:10,outputTokens:2,totalTokens:12},gateway:{cost:'0',marketCost:'0.001'}};
}
async function setup(t,evaluate){const directory=await mkdtemp(path.join(tmpdir(),'jev-dashboard-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));const runner=new EvaluationRunner({directory,states:stateMap(),evaluate,intervalMs:0,retryBaseMs:1});await runner.init();return runner;}
async function until(predicate){const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw new Error('Timed out waiting for local test state');await sleep(5);}}

test('historical totals match the frozen 200 requests; unscored rows have no inherited labels',async()=>{
  const dataset=await loadDataset();const summary=metrics(dataset.history.items);
  assert.equal(dataset.rows.length,100);assert.equal(summary.completed,100);assert.equal(summary.requests,200);assert.equal(summary.judgments,600);assert.equal(summary.cost,0);assert.equal(summary.costKnown,200);assert.equal(summary.gaps,6);assert.equal(summary.badcases,0);assert.equal(summary.uncertain,16);
  assert.ok(dataset.rows.every(row=>row.labels===undefined));
  assert.equal(metrics([{rowId:'waiting',modes:{}}]).cost,null);
  assert.deepEqual(signals(answersOf({modes:{query:{status:'failed'}}})).queues,[]);
});

test('upstream timing stays separate from local scheduling and missing timing is not zero',()=>{
  const gateway={routing:{modelAttempts:[{providerAttempts:[
    {success:false,startTime:1000,endTime:2000},
    {success:true,startTime:2100,endTime:2250},
  ]}]}};
  assert.equal(providerDuration(gateway),150);
  assert.equal(providerDuration({}),null);
  const item={modes:{query:{result:{durationMs:2600,providerDurationMs:150}},qa:{result:{durationMs:2400,providerDurationMs:170}}}};
  assert.equal(itemDuration(item),5000);assert.equal(itemProviderDuration(item),320);
  delete item.modes.qa.result.providerDurationMs;assert.equal(itemProviderDuration(item),null);
});

test('pause drains one in-flight request; resume evaluates only the remaining mode',async t=>{
  let release,calls=0;
  const gate=new Promise(resolve=>release=resolve);
  t.after(()=>release());
  const runner=await setup(t,async request=>{calls++;if(calls===1)await gate;return localResult(request);});
  const run=await runner.create(['S-test']);await until(()=>calls===1);
  await runner.action(run.id,'pause');assert.equal(run.status,'pausing');release();await until(()=>run.status==='paused');
  assert.equal(calls,1);assert.equal(run.items[0].modes.query.status,'completed');assert.equal(run.items[0].modes.qa.status,'queued');
  await runner.action(run.id,'resume');await until(()=>run.status==='completed');assert.equal(calls,2);assert.equal(metrics(run.items).judgments,6);
  await assert.rejects(runner.action(run.id,'resume'),/不能继续/);
});

test('temporary 503 retries without manufacturing badcases or duplicate successful results',async t=>{
  let calls=0;
  const runner=await setup(t,async request=>{if(++calls===1)throw Object.assign(new Error('local test'),{statusCode:503});return localResult(request);});
  const run=await runner.create(['S-test']);await until(()=>run.status==='completed');
  assert.equal(calls,3);assert.equal(run.items[0].modes.query.attempts,2);assert.equal(metrics(run.items).requests,2);assert.equal(metrics(run.items).badcases,0);
});

test('403 pauses the batch, and an explicit retry resumes failed and queued work',async t=>{
  let calls=0;
  const runner=await setup(t,async()=>{calls++;throw {statusCode:403};});
  const run=await runner.create(['S-test']);await until(()=>run.status==='paused');assert.equal(calls,1);assert.equal(metrics(run.items).requests,0);
  runner.evaluate=async request=>{calls++;return localResult(request);};
  await runner.action(run.id,'retry');await until(()=>run.status==='completed');assert.equal(calls,3);
});

test('restarting marks an uncertain request failed and keeps completed results',async t=>{
  const runner=await setup(t,async request=>localResult(request));
  const run=await runner.create(['S-test']);await until(()=>run.status==='completed');await runner.save(run);
  const file=path.join(runner.directory,`${run.id}.json`),disk=JSON.parse(await readFile(file,'utf8'));
  disk.status='running';disk.endedAt=null;disk.items[0].modes.qa={status:'running',attempts:1};await writeFile(file,JSON.stringify(disk));
  let calls=0;const restarted=new EvaluationRunner({directory:runner.directory,states:stateMap(),evaluate:async request=>{calls++;return localResult(request);},intervalMs:0});await restarted.init();
  const restored=restarted.runs.get(run.id);assert.equal(restored.status,'interrupted');assert.equal(restored.items[0].modes.query.status,'completed');assert.equal(restored.items[0].modes.qa.status,'failed');
  await assert.rejects(restarted.action(run.id,'resume'),/没有待处理/);
  await restarted.action(run.id,'retry');await until(()=>restored.status==='completed');assert.equal(calls,1);
});

test('HTTP guards reject foreign origins, missing tokens, and filesystem paths before any evaluation',async t=>{
  let calls=0;const runner=await setup(t,async request=>{calls++;return localResult(request);});
  const dataset={rows:[{id:'S-test',query:sample.current.query.text,answer:sample.current.answer.text}],history:{items:[]},contract:{},states:stateMap()};
  const server=createDashboardServer({dataset,runner,apiConfigured:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const bootstrap=await (await fetch(origin+'/api/bootstrap')).json();assert.ok(bootstrap.csrf);assert.equal(JSON.stringify(bootstrap).includes('AI_GATEWAY_API_KEY'),false);
  assert.equal((await fetch(origin+'/.env.local')).status,404);
  assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['S-test']})})).status,403);
  assert.equal((await fetch(origin+'/api/runs',{method:'POST',headers:{Origin:'https://example.invalid','X-Dashboard-Token':bootstrap.csrf},body:JSON.stringify({ids:['S-test']})})).status,403);assert.equal(calls,0);
  const response=await fetch(origin+'/api/runs',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Dashboard-Token':bootstrap.csrf},body:JSON.stringify({ids:['S-test']})});assert.equal(response.status,201);
  const created=await response.json();await until(()=>runner.runs.get(created.id).status==='completed');assert.equal(calls,2);
});
