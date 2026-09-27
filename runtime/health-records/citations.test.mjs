import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {parseHTML} from 'linkedom';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const packages=process.env.DSH_PACKAGE_ROOT??fileURLToPath(new URL('../dsh/node_modules/@deepseek-ai',import.meta.url));
const version=JSON.parse(await readFile(path.join(packages,'dsh/package.json'),'utf8')).version;
const upgraded=version==='0.1.7-rc.2';
const installed=await readFile(path.join(packages,'dsh-web-frontend/dist/assets',upgraded?'index-Q6zc2uHV.js':'index-BKQ_L1z6.js'),'utf8');
// Exercise the shipped adapter, including its version-specific React bindings.
const helper=installed.slice(installed.indexOf('function bcCitationNumber('),installed.indexOf(upgraded?'function E8(':'function C8('));
const link=upgraded?installed.slice(installed.indexOf('function E8('),installed.indexOf('function S8('))
 :installed.slice(installed.indexOf('function C8('),installed.indexOf('function m8('));
const corpus=JSON.parse(await readFile(new URL('../../data/medical-kb/corpus.json',import.meta.url),'utf8'));
const ctx=vm.createContext({I:React,d:jsxRuntime,j:React,l:jsxRuntime,URL,lt:{linkIcon:'normal-link-icon'},dt:{linkIcon:'normal-link-icon'},F0:()=>({}),
  bcCitationSources:Object.fromEntries(corpus.sources.map(source=>[source.url,source])),
  C8:url=>/^https?:\/\//.test(url)?url:'',_o:()=>React.createElement('svg',{'data-link-icon':true}),
  u8:url=>/^https?:\/\//.test(url)?url:'',Ho:()=>React.createElement('svg',{'data-link-icon':true})});
vm.runInContext(helper+'\n'+link+'\n globalThis.renderCitations=bcRenderCitations; globalThis.link='+(upgraded?'E8':'C8')+';',ctx);
if(upgraded)ctx.bcCitationLinkComponent=vm.runInContext('Cb',ctx);
const h=React.createElement;
const html=nodes=>parseHTML('<html><body>'+renderToStaticMarkup(h('div',null,nodes))+'</body></html>').document;

test('numeric reference links show brackets without icons, ordinary links retain behavior',()=>{
  const citation=html(ctx.link('https://example.org/evidence',['1'],'citation'));
  assert.equal(citation.querySelector('a').textContent,'[1]');
  assert.equal(citation.querySelector('svg'),null);
  assert.equal(citation.querySelector('a').getAttribute('href'),'https://example.org/evidence');
  assert.equal(citation.querySelector('a').getAttribute('rel'),'noopener noreferrer');
  const normal=html(ctx.link('https://example.org',['官方资料'],'normal'));
  assert.ok(normal.querySelector('svg'));
  assert.equal(html(ctx.link('javascript:alert(1)',['1'],'bad')).querySelector('a'),null);
});

test('reference section is a separate initially collapsed native disclosure preserving sources',()=>{
  const source=h('a',{href:'https://example.org'},'原文');
  const nodes=[h('p',{key:'answer'},'诊疗讨论'),h('p',{key:'heading'},h('strong',null,'引用')),
    '\n',h('ol',{key:'sources'},h('li',null,'CDC. 2025. ',source)),
    h('h2',{key:'next'},'下一步'),h('p',{key:'last'},'补充资料')];
  const output=ctx.renderCitations(nodes),doc=html(output),details=doc.querySelector('details');
  assert.ok(details);assert.equal(details.hasAttribute('open'),false);
  assert.equal(details.querySelector('summary').textContent,'全部引用');
  assert.equal(details.querySelectorAll('summary svg').length,2);
  assert.equal(details.querySelector('li').textContent,'CDC. 2025. 原文');
  assert.equal(details.querySelector('a').getAttribute('href'),'https://example.org');
  assert.equal(details.querySelector('h2'),null);
  assert.equal(doc.querySelectorAll('h2').length,1);
  details.setAttribute('open','');assert.ok(details.hasAttribute('open'));
  details.removeAttribute('open');assert.equal(details.hasAttribute('open'),false);
  assert.equal(ctx.renderCitations([...nodes,h('p',{key:'stream'},'新增内容')])[1].key,output[1].key);
});

test('known medical references use real source metadata and preserve source locators',()=>{
  const url='https://www.cdc.gov/act-early/hcp/index.html';
  const nodes=[h('p',{key:'heading'},h('strong',null,'引用')),
    h('ol',{key:'sources'},h('li',null,'CDC. 版本 2025-07-07，locator: Developmental surveillance；人群：儿童。',h('a',{href:url},url)))];
  const doc=html(ctx.renderCitations(nodes));
  assert.equal(doc.querySelector('.bc-reference-kind').textContent,'机构资料');
  assert.equal(doc.querySelector('.bc-reference-title').textContent,'儿童发育监测与标准化筛查的区别');
  assert.equal(doc.querySelector('.bc-reference-title').getAttribute('href'),url);
  assert.match(doc.querySelector('.bc-reference-item').textContent,/2025-07-07/);
  assert.match(doc.querySelector('.bc-reference-item').textContent,/原文定位：Developmental surveillance/);
  const older=[nodes[0],h('ol',{key:'sources'},h('li',null,'CDC. 版本 2020-01-01。',h('a',{href:url},url)))];
  const oldDoc=html(ctx.renderCitations(older));
  assert.equal(oldDoc.querySelector('.bc-reference-kind'),null);
  assert.match(oldDoc.querySelector('li').textContent,/2020-01-01/);
  assert.doesNotMatch(oldDoc.querySelector('li').textContent,/2025-07-07/);
});

test('actual DSH link components are recognized before React renders the reference section',()=>{
  const url='https://www.cdc.gov/act-early/hcp/index.html';
  const nodes=[h('p',{key:'answer'},'筛查说明 ',ctx.link(url,['1'],'inline')),
    h('h3',{key:'heading'},'引用'),h('ol',{key:'sources'},h('li',null,'CDC. 版本 2025-07-07，',ctx.link(url,[url],'source')))];
  const doc=html(ctx.renderCitations(nodes));
  assert.equal(doc.querySelector('p a').textContent,'[1]');
  assert.ok(doc.querySelector('.bc-references'));
  assert.equal(doc.querySelector('.bc-reference-title').textContent,'儿童发育监测与标准化筛查的区别');
  assert.equal(doc.querySelector('.bc-reference-title').getAttribute('href'),url);
  const unknown='https://example.org/evidence';
  const other=html(ctx.renderCitations([h('h3',{key:'heading'},'引用'),h('ol',{key:'sources'},h('li',null,ctx.link(unknown,['资料原文'],'unknown')))]));
  assert.equal(other.querySelector('.bc-reference-unstructured a').getAttribute('href'),unknown);
});

test('code examples and citation-like prose are not folded',()=>{
  const nodes=[h('pre',{key:'code'},h('code',null,'引用\n1. https://example.org')),
    h('p',{key:'sentence'},'请在引用部分补充资料'),h('p',{key:'title'},h('strong',null,'引用')),
    h('p',{key:'missing'},'暂无可引用原文')];
  const doc=html(ctx.renderCitations(nodes));
  assert.equal(doc.querySelector('details'),null);
  assert.equal(doc.querySelector('code').textContent,'引用\n1. https://example.org');
});

test('literal sup citations from the actual answer format resolve its explicit bibliography',()=>{
  const url='https://www.cdc.gov/act-early/hcp/index.html';
  const nodes=[h('blockquote',{key:'answer'},h('p',null,'服务与支持','<sup>','[1]','</sup>','。')),
    h('p',{key:'heading'},'引用'),h('p',{key:'source'},'[1] ',ctx.link(url,['CDC · Resources for Healthcare Providers'],'source'),' — CDC，版本 2025-07-07')];
  const doc=html(ctx.renderCitations(nodes));
  assert.equal(doc.querySelector('blockquote').textContent,'服务与支持[1]。');
  assert.equal(doc.querySelector('blockquote a').getAttribute('href'),url);
  assert.equal(doc.querySelector('blockquote a').textContent,'[1]');
  assert.ok(doc.querySelector('.bc-references .bc-reference-title'));
  assert.equal(doc.querySelector('sup'),null);
});

test('sup compatibility never enables HTML, edits code, or guesses unresolved and conflicting sources',()=>{
  const literal='<sup>[1]</sup>';
  const doc=html(ctx.renderCitations([h('p',{key:'plain'},literal+' <img src=x onerror=alert(1)>'),
    h('pre',{key:'code'},h('code',null,literal)),h('p',{key:'inline'},h('code',null,literal))]));
  assert.equal(doc.querySelector('p').textContent,'[1] <img src=x onerror=alert(1)>');
  assert.equal(doc.querySelectorAll('a,img,sup').length,0);
  assert.ok([...doc.querySelectorAll('code')].every(node=>node.textContent===literal));
  const conflicting=html(ctx.renderCitations([h('p',{key:'answer'},literal),h('h3',{key:'heading'},'引用'),
    h('p',{key:'one'},'[1] ',ctx.link('https://example.org/one',['来源一'],'one')),
    h('p',{key:'two'},'[1] ',ctx.link('https://example.org/two',['来源二'],'two'))]));
  assert.equal(conflicting.querySelector('p').querySelector('a'),null);
});

test('ordinary markdown with separators, line breaks, images and task checkboxes still renders',()=>{
  const nodes=[h('h2',{key:'heading'},'两者的区别'),
    h('p',{key:'paragraph'},'第一行',h('br',{key:'break'}),'第二行'),h('hr',{key:'separator'}),
    h('ul',{key:'list'},h('li',null,h('input',{type:'checkbox',checked:true,disabled:true}),'核对来源')),
    h('img',{key:'image',src:'https://example.org/image.png',alt:'说明'}),
    h('p',{key:'answer'},'完整回答')];
  const doc=html(ctx.renderCitations(nodes));
  assert.equal(doc.querySelectorAll('hr,br,img,input').length,4);
  assert.match(doc.body.textContent,/第一行第二行/);
  assert.match(doc.body.textContent,/完整回答/);
  assert.ok(doc.querySelector('input').hasAttribute('checked'));
});

test('overlay installs the shared renderer adapter and scopes clinic entry to active conversations',async()=>{
  assert.equal(installed.split('function bcRenderCitations(').length-1,1);
  assert.ok(installed.includes(upgraded?'"data-markdown-variant":f==="compact"?f:void 0,children:bcRenderCitations(m)':'className:lt.markdown,children:bcRenderCitations(m)'));
  if(upgraded)assert.ok(installed.includes('const bcCitationLinkComponent=Cb;'));
  const css=await readFile(new URL('../../config/health-records/panel.css',import.meta.url),'utf8');
  assert.match(css,/\[data-phase="active"\] \.bc-health-entry\{position:absolute;top:10px/);
  assert.match(css,/\[data-phase="active"\] \.bc-health-entry:before\{display:none\}/);
});
