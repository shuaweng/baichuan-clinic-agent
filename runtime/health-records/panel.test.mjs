import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
import {parseHTML} from 'linkedom';
import React,{act} from 'react';
import * as ReactDOM from 'react-dom';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
const core=await readFile(new URL('../../config/health-records/core.js',import.meta.url),'utf8'),panel=await readFile(new URL('../../config/health-records/panel.js',import.meta.url),'utf8');
const delay=()=>new Promise(r=>setTimeout(r,10));
async function mount(t,sessionId='session-ui'){
 const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
 window.confirm=()=>true;window.HTMLIFrameElement??=class{};
 window.HTMLElement.prototype.showModal=function(){this.setAttribute('open','');};
 Object.assign(globalThis,{window,document,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const ctx=vm.createContext({window,document,react:React,react_dom:ReactDOM,indexedDB:new IDBFactory(),crypto:{randomUUID},structuredClone,Date,Uint8Array,URL,console});
 vm.runInContext(core+'\n'+panel+'\nglobalThis.Entry=BcHealthEntry;globalThis.records=bcHealth;',ctx);
 const root=createRoot(document.getElementById('root'));await act(async()=>root.render(React.createElement(ctx.Entry,{sessionId})));
 t.after(async()=>{await act(async()=>root.unmount());delete globalThis.window;delete globalThis.document;});
 async function click(node){assert.ok(node,'missing clickable element');await act(async()=>{Simulate.click(node);await delay();});}
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 async function change(node,value){assert.ok(node,'missing editable element');await act(async()=>{Simulate.change(node,{target:{value}});await delay();});}
 const until=async check=>{for(let i=0;i<40&&!check();i++)await act(async()=>{await delay();});assert.ok(check(),'UI state not reached');};
 await click(button('我的健康档案'));await until(()=>button('保存档案')&&!button('保存档案').disabled);
 return {document,store:ctx.records,click,change,button,until};
}
test('drawer edits and saves a real profile, opt-in reaches a visible one-shot composer chip and can be revoked',async t=>{
 const ui=await mount(t);const {document,store,click,change,button}=ui;
 assert.ok(document.querySelector('dialog[open]'));assert.match(document.body.textContent,/未记录/);assert.equal(store.getPending('session-ui'),undefined);
 await click(button('过敏史未记录›'));const textarea=document.querySelector('.bc-health-condition-editor textarea');await change(textarea,'青霉素过敏，用户记录');
 await click(button('保存档案'));assert.equal((await store.listMembers())[0].allergies,'青霉素过敏，用户记录');assert.equal(store.getPending('session-ui'),undefined);
 const consent=document.querySelector('.bc-health-footer input[type=checkbox]');await act(async()=>Simulate.change(consent));
 await click(button('保存档案'));assert.match(JSON.stringify(store.getPending('session-ui').snapshot),/青霉素/);
 await click(button('关闭'));assert.equal(document.querySelector('dialog'),null);assert.match(document.querySelector('.bc-health-armed').textContent,/下次提问使用/);
 await click(document.querySelector('[aria-label="取消本次使用健康档案"]'));assert.equal(store.getPending('session-ui'),undefined);assert.equal(document.querySelector('.bc-health-armed'),null);
});
test('family profiles, reports, previews and summary selection work without network or real medical data',async t=>{
 const ui=await mount(t);const {document,store,click,change,button,until}=ui;
 await click(button('+ 添加成员'));await change(document.querySelector('.bc-health-name input'),'孩子测试档案');await click(button('保存档案'));
 const child=(await store.listMembers()).find(m=>m.name==='孩子测试档案');assert.ok(child);
 const report=new File(['%PDF-1.7\n% isolated test'],'检查报告测试.pdf',{type:'application/pdf'});
 await act(async()=>{Simulate.change(document.querySelector('input[type=file]'),{target:{files:[report]}});await delay();});
 await until(()=>document.querySelector('.bc-health-report'));
 assert.match(document.querySelector('.bc-health-report').textContent,/检查报告测试.pdf/);assert.equal((await store.listReports('self')).length,0);
 await click(button('预览'));assert.ok(document.querySelector('iframe[sandbox]'));await click(button('返回档案'));
 await change(document.querySelector('.bc-health-report textarea'),'用户填写的测试摘要');
 await act(async()=>Simulate.change(document.querySelector('.bc-health-footer input[type=checkbox]')));
 await act(async()=>Simulate.change(document.querySelector('.bc-health-report input[type=checkbox]')));
 await click(button('保存档案'));assert.equal(store.getPending('session-ui').snapshot.用户填写的报告要点[0].用户填写的报告要点,'用户填写的测试摘要');
 await click(button('移除'));assert.equal((await store.listReports(child.id)).length,0);assert.equal(store.getPending('session-ui'),undefined);
});
test('without a workspace, records still save but consent is unavailable',async t=>{
 const {document,button,click,store}=await mount(t,null);
 assert.equal(document.querySelector('.bc-health-footer input[type=checkbox]').disabled,true);
 assert.match(document.querySelector('.bc-health-footer').textContent,/先选择工作区/);
 await click(button('保存档案'));assert.equal((await store.listMembers()).length,1);
});
