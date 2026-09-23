import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import markdownit from 'markdown-it';
import * as shared from './shared.mjs';
import {createMarkdownRenderer} from './markdown.mjs';
import {loadDataset} from './server.mjs';
import {QUERY_QUESTIONS_V2,QA_QUESTIONS_V2} from '../questions-v2.mjs';

async function mount(dataset){
 const html=await readFile(new URL('./public/index.html',import.meta.url),'utf8');const {window,document}=parseHTML(html);
 // linkedom does not implement form selectedness, modal dialogs, layout or scrolling.
 for(const select of document.querySelectorAll('select')){let chosen;Object.defineProperty(select,'value',{get:()=>chosen??select.querySelector('option')?.getAttribute('value')??'',set:value=>{chosen=value;}});}
 for(const el of document.querySelectorAll('dialog'))el.showModal=()=>el.setAttribute('open','');
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLElement.prototype.scrollTo=function(){};
 const payload={...dataset,questionVersion:dataset.contract.question_version,datasetId:dataset.id,datasets:[{id:dataset.id,name:'本地测试批次'}],runs:[],liveEligibleIds:[],csrf:'local-test',apiConfigured:false};
 const context=vm.createContext({window:Object.assign(window,{markdownit}),document,console,URL,URLSearchParams,Map,Set,Date,Blob,location:{search:''},setTimeout,clearTimeout,setInterval:()=>0,clearInterval:()=>{},fetch:async url=>({ok:true,json:async()=>url.startsWith('/api/rules')?{source:'本地规则',questionVersion:dataset.contract.question_version,productContract:dataset.contract.product_contract,questions:dataset.contract.questions}:payload}),EventSource:class{addEventListener(){}},...shared,LEGACY_FIELDS:shared.FIELDS,createMarkdownRenderer});
 let script=await readFile(new URL('./public/app.js',import.meta.url),'utf8');script=script.replace(/^import .*;\n/gm,'');vm.runInContext(script,context);
 await new Promise(resolve=>setTimeout(resolve,15));assert.notEqual(document.getElementById('connection').textContent,'加载失败',document.getElementById('notice').textContent);
 return {document,context};
}
test('legacy batch still mounts six judgments and renders markdown',async()=>{
 const data=await loadDataset();const {document}=await mount(data);
 assert.equal(document.querySelectorAll('.judgment').length,6);assert.equal(document.querySelectorAll('.qa-card').length,100);
 assert.ok(document.querySelector('.markdown-body'));assert.equal(document.getElementById('metric-done').textContent,'100');
});
test('reference batch mounts twelve judgments and exposes source, badcase drilldown and rules',async()=>{
 const old=await loadDataset();const row={...old.rows[0],id:'CMD-test',reference_material:{answer:'**参考**内容',csv_record_index:1,source_url:'https://github.com/example/source'},product_contract:old.contract.product_contract};
 const answers=Object.fromEntries(shared.V2_FIELDS.map(k=>[k,k==='explicit_dissatisfaction'?{type:'boolean',probability:.01}:{type:'choice',choice:k==='clinical_correctness'?'suspected_error':'not_applicable',probabilities:{[k==='clinical_correctness'?'suspected_error':'not_applicable']:.9,other:.1}}]));
 const data={id:'public-medical',rows:[row],history:{id:'public-test',items:[{rowId:row.id,modes:{query:{status:'completed',result:{answers:Object.fromEntries(Object.entries(answers).slice(0,3))}},qa:{status:'completed',result:{answers:Object.fromEntries(Object.entries(answers).slice(3))}}}}]},contract:{...old.contract,question_version:'medical-reference-0.2',questions:{query:QUERY_QUESTIONS_V2,qa:QA_QUESTIONS_V2}}};
 const {document}=await mount(data);
 assert.equal(document.querySelectorAll('.judgment').length,12);assert.equal(document.getElementById('metric-review').textContent,'1');
 assert.ok(document.querySelector('.reference-panel strong'));assert.equal(document.querySelector('.reference-panel a').href,row.reference_material.source_url);
 const button=[...document.querySelectorAll('.distribution-row')].find(b=>b.getAttribute('aria-label').includes('医疗风险候选'));button.click();
 assert.equal(document.querySelectorAll('.qa-card').length,1);assert.match(document.getElementById('distribution-filter-label').textContent,/医疗风险候选/);
 document.getElementById('rules-button').click();await new Promise(resolve=>setTimeout(resolve,5));assert.ok(document.getElementById('info-dialog').hasAttribute('open'));assert.match(document.getElementById('info-body').textContent,/用药安全/);
});
test('the completed public batch renders all fifty real sessions and reference counts',async()=>{
 const data=await loadDataset('public-medical-v2');const {document}=await mount(data);
 assert.equal(document.querySelectorAll('.qa-card').length,50);assert.equal(document.querySelectorAll('.judgment').length,12);
 assert.equal(document.getElementById('metric-done').textContent,'50');assert.equal(document.getElementById('metric-judgments').textContent,'600');
 const reference=[...document.querySelectorAll('.distribution-row')].find(b=>b.getAttribute('aria-label').includes('参考不足以核验'));
 assert.ok(reference);reference.click();assert.equal(document.querySelectorAll('.qa-card').length,43);
 document.getElementById('clear-distribution').click();assert.equal(document.querySelectorAll('.qa-card').length,50);
});

test('evidence audit renders comparison, fifteen judgments, source cards and badcase navigation',async()=>{
 const data=await loadDataset('public-medical');const {document}=await mount(data);
 assert.equal(document.querySelectorAll('.qa-card').length,50);assert.equal(document.querySelectorAll('.judgment').length,15);
 assert.equal(document.getElementById('metric-review').textContent,String(shared.metrics(data.history.items).badcases));
 assert.match(document.getElementById('comparison').textContent,/旧规则 0 条/);
 document.getElementById('review-metric').click();assert.equal(document.querySelectorAll('.qa-card').length,shared.metrics(data.history.items).badcases);
 assert.ok(document.querySelector('.audit-card blockquote'));assert.ok(document.querySelector('.audit-card a'));
 document.getElementById('rules-button').click();await new Promise(r=>setTimeout(r,5));assert.match(document.getElementById('info-body').textContent,/患者事实保真/);
});
