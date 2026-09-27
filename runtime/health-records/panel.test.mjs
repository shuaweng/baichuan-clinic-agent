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
 const local=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value),removeItem:key=>local.delete(key)}});
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
 await click(button('我的诊室档案'));await until(()=>button('保存档案')&&!button('保存档案').disabled);
 return {document,store:ctx.records,click,change,button,until};
}
test('clinic form persists fields across tabs; opted-in selection reaches one-shot chip and can be revoked',async t=>{
 const {document,store,click,change,button}=await mount(t);
 assert.ok(document.querySelector('dialog[open]'));assert.ok(!document.body.textContent.includes('与我的关系'));
 await change(document.querySelector('[data-clinic-field="name"]'),'门诊测试');await change(document.querySelector('[data-clinic-field="specialty"]'),'妇科');
 await click(button('青春期保健'));await click(button('诊疗工作'));await click(button('病例梳理'));await click(button('+ 添加资源'));
 await change(document.querySelector('[aria-label="资源名称 1"]'),'检查 A');await change(document.querySelector('[aria-label="资源状态 1"]'),'需转诊');await click(button('保存档案'));
 const saved=(await store.listMembers()).find(m=>m.name==='门诊测试');assert.equal(saved.directions[0],'青春期保健');assert.equal(saved.tasks[0],'病例梳理');assert.equal(saved.resources[0].status,'需转诊');assert.equal(store.getPending('session-ui'),undefined);
 await act(async()=>Simulate.change(document.querySelector('.bc-health-footer input[type=checkbox]')));await click(button('保存档案'));assert.match(JSON.stringify(store.getPending('session-ui').snapshot),/需转诊/);
 await click(button('关闭'));assert.match(document.querySelector('.bc-health-armed').textContent,/门诊测试/);await click(document.querySelector('[aria-label="取消本次使用诊室档案"]'));assert.equal(store.getPending('session-ui'),undefined);
});
test('clinic switching, document metadata, readiness gating and report preview work in isolation',async t=>{
 const {document,store,click,change,button,until}=await mount(t);
 await click(button('+ 添加诊室'));await change(document.querySelector('[data-clinic-field="name"]'),'儿科测试');await change(document.querySelector('[data-clinic-field="specialty"]'),'儿科');await click(button('保存档案'));
 const clinic=(await store.listMembers()).find(m=>m.name==='儿科测试');assert.ok(clinic);await click(button('资料与模板'));
 const file=new File(['%PDF-1.7\n% isolated test'],'流程.pdf',{type:'application/pdf'});
 await act(async()=>{Simulate.change(document.querySelector('input[type=file]'),{target:{files:[file]}});await delay();});await until(()=>document.querySelector('.bc-health-report'));
 assert.equal((await store.listReports('self')).length,0);await click(button('预览'));assert.ok(document.querySelector('iframe[sandbox]'));await click(button('返回档案'));
 await change(document.querySelector('[data-report-field="status"]'),'可供 Agent 引用');await click(button('保存档案'));assert.match(document.querySelector('[role=alert]').textContent,/来源/);
 await change(document.querySelector('[data-report-field="source"]'),'测试机构');await change(document.querySelector('[data-report-field="version"]'),'2026-09');await change(document.querySelector('[data-report-field="summary"]'),'院内流程要点');await change(document.querySelector('[data-report-field="category"]'),'院内流程');
 await act(async()=>Simulate.change(document.querySelector('.bc-health-footer input[type=checkbox]')));await act(async()=>Simulate.change(document.querySelector('.bc-health-report input[type=checkbox]')));await click(button('保存档案'));
 assert.equal(store.getPending('session-ui').snapshot.参考资料[0].医生确认的资料要点,'院内流程要点');
 await change(document.querySelector('[aria-label="当前诊室"]'),'self');assert.equal(store.getPending('session-ui'),undefined);assert.equal(document.querySelectorAll('.bc-health-report').length,0);
 await change(document.querySelector('[aria-label="当前诊室"]'),clinic.id);await click(button('移除'));assert.equal((await store.listReports(clinic.id)).length,0);
});
test('empty clinic cannot save, and no workspace leaves consent disabled',async t=>{
 const {document,button,click,change,store}=await mount(t,null);assert.equal(document.querySelector('.bc-health-footer input[type=checkbox]').disabled,true);
 await click(button('保存档案'));assert.match(document.querySelector('[role=alert]').textContent,/诊室名称/);
 await change(document.querySelector('[data-clinic-field="name"]'),'测试诊室');await change(document.querySelector('[data-clinic-field="specialty"]'),'妇科');await click(button('保存档案'));assert.equal((await store.listMembers())[0].name,'测试诊室');
});
