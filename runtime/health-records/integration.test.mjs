import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import path from 'node:path';
const core=await readFile(new URL('../../config/health-records/core.js',import.meta.url),'utf8');
const installed=await readFile(process.env.DSH_PACKAGE_ROOT
 ? path.join(process.env.DSH_PACKAGE_ROOT,'dsh-client-ui-conversation/lib/client.js')
 : new URL('../dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',import.meta.url),'utf8');
test('the actual patched DSH send seam carries one consented snapshot and preserves attachments and transport arguments',async()=>{
 const start=installed.indexOf('\t\t\tsink(session, text, attachmentIds, mode, signal) {');assert.ok(start>0);
 const end=installed.indexOf('\n\t\t\t}',start)+5;const method=installed.slice(start,end);
 const ctx=vm.createContext({indexedDB:new IDBFactory(),crypto:{randomUUID},structuredClone,Date,Uint8Array});
 vm.runInContext(core+'\nclass PatchedSink{'+method+'}\nglobalThis.sink=new PatchedSink();globalThis.store=bcHealth;',ctx);
 const calls=[];ctx.sink.conversation=()=>({sendSession:async(...args)=>{calls.push(args);return {kind:'success'};}});
 const session={sessionId:'actual-session',projectionValues:{agentPreset:'baichuan-office'}},ids=['attachment-1'],signal={test:'signal'};
 ctx.store.setPending(session.sessionId,ctx.store.makeSnapshot({...ctx.store.emptyMember('self','测试诊室'),specialty:'妇科',institution:'隔离测试',workflow:'临床流程应排除'},['institution','workflow'],[]),'self');
 await ctx.sink.sink(session,'请整理病情',ids,'queue',signal);assert.equal(calls.length,1);assert.equal(calls[0][0],session);assert.match(calls[0][1],/隔离测试/);assert.ok(!calls[0][1].includes('临床流程应排除'));assert.match(calls[0][1],/办公模式/);assert.equal(calls[0][2],ids);assert.equal(calls[0][3],'queue');assert.equal(calls[0][4],signal);
 await ctx.sink.sink(session,'下一条问题',ids,'steer',signal);assert.equal(calls[1][1],'下一条问题');
});
test('pinned overlay has one real composer entry and one send integration; native modal and file controls are present',()=>{
 assert.equal(installed.split('(0, react_jsx_runtime.jsx)(BcHealthEntry,').length-1,1);
 assert.equal(installed.split('return bcHealth.withContext(session.sessionId, text,').length-1,1);
 assert.match(installed,/showModal\(\)/);assert.match(installed,/bcHealth\.addReport\(owner.id,file\)/);
});
