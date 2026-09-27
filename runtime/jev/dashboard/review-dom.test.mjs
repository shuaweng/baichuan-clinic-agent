import test from 'node:test';import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';import vm from'node:vm';import{parseHTML}from'linkedom';import markdownit from'markdown-it';import{createMarkdownRenderer}from'./markdown.mjs';import{TITLES,LABELS}from'./shared.mjs';
import{reviewData}from'../../review/api.mjs';
for(const dataset of ['physician','physician-100'])test(dataset+': review UI renders actual QA, evidence, model comparison and board without auto-calling models',async()=>{
const data=await reviewData(dataset);const{window,document}=parseHTML(await readFile(new URL('./public/review.html',import.meta.url),'utf8'));
for(const select of document.querySelectorAll('select')){let selected;Object.defineProperty(select,'value',{get:()=>selected??select.querySelector('option')?.getAttribute('value')??'',set:v=>selected=v});}
for(const el of document.querySelectorAll('dialog'))el.showModal=()=>el.setAttribute('open','');let calls=0;
const context=vm.createContext({window:Object.assign(window,{markdownit}),document,URL,URLSearchParams,Blob,Map,Set,console,location:{search:'?dataset='+dataset,href:'http://127.0.0.1:3081/review?dataset='+dataset},history:{replaceState(){}},setTimeout,clearTimeout,setInterval:()=>0,fetch:async(url,opts)=>{calls++;assert.ok(!opts?.method);return{ok:true,json:async()=>({...data,csrf:'test'})};},TITLES,LABELS,createMarkdownRenderer});
const script=(await readFile(new URL('./public/review.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');vm.runInContext(script,context);await new Promise(r=>setTimeout(r,30));
assert.equal(document.getElementById('notice').hidden,true,document.getElementById('notice').textContent);assert.equal(document.querySelectorAll('.queue-item').length,data.rows.length);assert.equal(calls,1);assert.ok(document.getElementById('qa').textContent.length>100);
document.getElementById('board-tab').click();assert.equal(document.getElementById('board-view').hidden,false);
if(data.clusters.length){document.querySelector('.cluster-row').click();assert.ok(document.querySelector('.member-link'));document.querySelector('.member-link').click();assert.equal(document.getElementById('review-view').hidden,false);}
document.getElementById('prompt').click();assert.ok(document.getElementById('dialog').hasAttribute('open'));
});
