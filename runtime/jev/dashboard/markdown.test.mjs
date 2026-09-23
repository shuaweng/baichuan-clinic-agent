import test from 'node:test';
import assert from 'node:assert/strict';
import markdownit from 'markdown-it';
import {createMarkdownRenderer} from './markdown.mjs';
import {loadDataset} from './server.mjs';
const render=createMarkdownRenderer(markdownit);

test('renders Chinese emphasis, headings, nested lists, tables, quotes and fenced code',()=>{
  const html=render('# 检查记录\n\n**重点**与`数值`\n\n- 第一项\n  - 子项\n\n1. 下一步\n\n> 原始记录\n\n| 项目 | 内容 |\n| --- | --- |\n| 时间 | 今天 |\n\n```js\nconst x = "<tag>";\n```');
  for(const tag of ['<h1>检查记录</h1>','<strong>重点</strong>','<code>数值</code>','<ul>','<ol>','<blockquote>','<table>','<th>项目</th>','<td>今天</td>','<pre><code class="language-js">'])assert.ok(html.includes(tag),tag);
  assert.ok(html.includes('&lt;tag&gt;'));
});

test('does not execute raw HTML, unsafe URLs or load conversation images',()=>{
  const html=render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert(1))\n\n[文档](https://example.com)\n\n![图片](https://example.com/tracker.png)');
  assert.ok(!/<script|<img|href="javascript:/i.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('[图片：图片]'));
});

test('renders the frozen QA dataset without changing its source text',async()=>{
  const {rows}=await loadDataset();const before=JSON.stringify(rows);
  for(const row of rows){assert.ok(render(row.query));assert.ok(render(row.answer));}
  assert.equal(JSON.stringify(rows),before);
  assert.ok(rows.some(row=>render(row.answer).includes('<strong>')));
});
