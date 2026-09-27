import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {loadKnowledgeBase} from './core.mjs';
import {closeRetriever} from './retriever.mjs';
import {apply} from './dsh-plugin.mjs';
const kb=loadKnowledgeBase();
after(closeRetriever);

test('Chinese clinician topics retrieve actual CDC evidence through Haystack',async()=>{
  for(const [q,source,scope] of [
    ['儿童发育监测与标准化筛查','cdc-development','pediatrics'],
    ['避孕共同决策与生殖自主','cdc-contraception','gynecology'],
    ['生长百分位与体重测量','cdc-growth','pediatrics'],
    ['儿童脑震荡影像检查','cdc-pediatric-mtbi','pediatrics']
  ]){
    const result=await kb.search(q,{specialty:scope});
    assert.equal(result.results[0].source.id,source);
    assert.match(result.method,/Haystack/);
    const full=kb.read(result.results[0].id);
    assert.ok(full.text.length>100);assert.ok(full.locator);
    assert.equal(kb.verifyQuote(full.id,full.text.slice(0,80)).status,'exact_match');
    assert.equal(kb.verifyQuote(full.id,'编造的临床依据').status,'not_found');
    assert.equal(full.semantic_support,'not_checked');
  }
});
test('No matches and unknown evidence fail without fabricated citations',async()=>{
  assert.equal((await kb.search('zzzxxyqvv')).not_found,true);
  assert.throws(()=>kb.read('invented'));
  await assert.rejects(kb.search('valid',{limit:100}));
});
test('Humanitarian rules are excluded from ordinary clinic retrieval',async()=>{
  const ordinary=await kb.search('儿童腹泻脱水 diarrhoea dehydration',{specialty:'pediatrics',limit:6});
  assert.ok(ordinary.results.every(r=>r.source.id!=='who-ccc'));
  const emergency=await kb.search('人道主义 儿童腹泻脱水 diarrhoea dehydration',{specialty:'pediatrics',limit:6});
  assert.ok(emergency.results.some(r=>r.source.id==='who-ccc'));
});
test('DSH definitions expose executable tools and source cards',async()=>{
  const definitions=[];apply({tools:{register:d=>definitions.push(d)}});
  assert.equal(definitions.length,3);
  const tool=definitions.find(d=>d.name==='medical_kb_search');
  const args={query:'避孕共同决策',specialty:'gynecology'};
  const value=await tool.execute(args,{});
  assert.equal(value.results[0].source.id,'cdc-contraception');
  assert.equal(tool.presentResult(args,{meta:value}).card,'web');
});
