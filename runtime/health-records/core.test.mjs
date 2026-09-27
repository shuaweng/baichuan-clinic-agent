import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const code=await readFile(new URL('../../config/health-records/core.js',import.meta.url),'utf8');
function store(indexedDB=new IDBFactory()){const ctx=vm.createContext({indexedDB,crypto:{randomUUID},structuredClone,Date,Uint8Array,console});return vm.runInContext(code+';bcHealth',ctx);}
const file=(name='report.pdf',type='application/pdf',data='%PDF-1.7\nlocal isolated test')=>new File([data],name,{type});
const clinic=(s,id='self',name='妇科一诊室')=>({...s.emptyMember(id,name),specialty:'妇科'});
const ready=(r,extra={})=>({...r,title:r.title||'测试资料',category:'指南与共识',scope:'通用',source:'测试发布机构',version:'2026-09',status:'可供 Agent 引用',summary:'已确认的资料要点',...extra});
test('clinic records persist, empty fields remain unknown, legacy database stays untouched, and stale writes fail',async()=>{
 const idb=new IDBFactory();
 await new Promise((resolve,reject)=>{const q=idb.open('baichuan-health-records',1);q.onupgradeneeded=()=>q.result.createObjectStore('members',{keyPath:'id'});q.onsuccess=()=>{const db=q.result,tx=db.transaction('members','readwrite');tx.objectStore('members').put({id:'self',name:'原健康档案',allergies:'旧数据'});tx.oncomplete=()=>{db.close();resolve();};};q.onerror=reject;});
 const s=store(idb),[blank]=await s.listMembers();assert.equal(blank.name,'');assert.equal(blank.institution,'');assert.equal(blank.allergies,undefined);
 const saved=await s.saveMember({...clinic(s),institution:'测试机构',resources:[{name:'检查 A',status:'待确认'}]});
 assert.equal((await store(idb).listMembers())[0].institution,'测试机构');
 await assert.rejects(s.saveMember({...blank,name:'过期编辑',specialty:'妇科'}),/其他页面/);
 const legacy=await new Promise(resolve=>{const q=idb.open('baichuan-health-records');q.onsuccess=()=>{const db=q.result,r=db.transaction('members').objectStore('members').get('self');r.onsuccess=()=>{resolve(r.result);db.close();};};});assert.equal(legacy.allergies,'旧数据');assert.equal(saved.revision,1);
});
test('required clinic fields, resource states, and field limits are validated',async()=>{
 const s=store();for(const patch of [{name:''},{specialty:''},{resources:[{name:'',status:'可开展'}]},{resources:[{name:'超声',status:'不存在'}]},{workflow:'a'.repeat(2001)}])await assert.rejects(s.saveMember({...clinic(s),...patch}));
 assert.equal((await s.listMembers())[0].revision,0);
});
test('documents validate signatures and metadata, isolate clinics, preserve original blobs and reject stale edits',async()=>{
 const s=store(),first=await s.saveMember(clinic(s)),second=await s.saveMember(clinic(s,'other','儿科门诊'));
 await assert.rejects(s.addReport(first.id,file('bad.pdf','application/pdf','<script>')),/有效/);
 const r=await s.addReport(second.id,file());assert.equal(r.status,'已上传');assert.equal((await s.listReports(first.id)).length,0);await assert.rejects(s.getReport(r.id,first.id),/不存在/);
 await assert.rejects(s.updateReport({...r,status:'可供 Agent 引用'}),/来源/);
 const saved=await s.updateReport(ready(r));assert.equal(saved.revision,2);await assert.rejects(s.updateReport(ready(r)),/变更/);
 assert.match(await (await s.getReport(r.id,second.id)).blob.text(),/%PDF/);await s.deleteReport(r.id,second.id);assert.equal((await s.listReports(second.id)).length,0);
});
test('snapshots whitelist selected fields, ready documents and same clinic; modes filter references',()=>{
 const s=store(),m={...clinic(s),institution:'可用机构',workflow:'未选流程'};
 const docs=[ready({memberId:'self',title:'妇科资料'},{scope:'妇科'}),ready({memberId:'self',title:'儿科资料'},{scope:'儿科'}),ready({memberId:'self',title:'办公模板'},{category:'办公模板',scope:'办公模式'}),ready({memberId:'other',title:'其他诊室秘密'}),ready({memberId:'self',title:'过期资料'},{status:'待更新'})];
 const snap=s.makeSnapshot(m,['institution','specialty','unknown'],docs),out=JSON.stringify(snap);
 assert.ok(!out.includes('未选流程')&&!out.includes('其他诊室秘密')&&!out.includes('过期资料')&&!out.includes('blob'));
 assert.equal(snap.参考资料.length,3);assert.equal(s.forMode(snap,'妇科').参考资料[0].资料名称,'妇科资料');assert.equal(s.forMode(snap,'妇科').参考资料.length,1);
 const office=s.forMode(snap,'办公模式');assert.equal(office.参考资料[0].资料名称,'办公模板');assert.equal(office.诊室信息.默认专科模式,undefined);assert.equal(office.诊室信息.所属机构,'可用机构');assert.equal(s.forMode(snap,undefined).参考资料.length,0);
 assert.throws(()=>s.makeSnapshot(m,[],[]),/至少一项/);
});
test('consent stays scoped to one session, survives failure, is immutable and is consumed once',async()=>{
 const s=store(),snap=s.makeSnapshot(clinic(s),['specialty'],[]),texts=[];const send=async text=>{texts.push(text);return {kind:'success'};};
 await s.withContext('s1','问题',send);assert.equal(texts.pop(),'问题');s.setPending('s1',snap,'self');snap.诊室信息.默认专科模式='不应混入';
 await s.withContext('s2','其他会话',send);assert.equal(texts.pop(),'其他会话');
 await assert.rejects(s.withContext('s1','问题',async()=>{throw new Error('transport');}),/transport/);assert.equal(s.getPending('s1').inFlight,false);
 await s.withContext('s1','问题',send,'baichuan-gynecology');assert.match(texts.at(-1),/诊室档案/);assert.ok(!texts.at(-1).includes('不应混入'));assert.equal(s.getPending('s1'),undefined);
 await s.withContext('s1','后续问题',send);assert.equal(texts.pop(),'后续问题');
});
test('editing or disabling source documents invalidates queued snapshots; in-flight edits are blocked',async()=>{
 const s=store(),m=await s.saveMember(clinic(s)),r=await s.updateReport(ready(await s.addReport(m.id,file())));
 s.setPending('s',s.makeSnapshot(m,['specialty'],[r]),m.id,[r.id]);
 let release;const pending=s.withContext('s','问题',()=>new Promise(resolve=>release=resolve));
 await assert.rejects(s.updateReport({...r,status:'已停用'}),/正在发送/);assert.throws(()=>s.setPending('s',null),/正在发送/);release({kind:'error'});await pending;
 await s.updateReport({...r,status:'已停用'});assert.equal(s.getPending('s'),undefined);
 s.setPending('s',s.makeSnapshot(m,['specialty'],[]),m.id);await s.saveMember({...m,institution:'新机构'});assert.equal(s.getPending('s'),undefined);
});
test('removing a clinic cascades only its documents and pending snapshots',async()=>{
 const s=store(),a=await s.saveMember(clinic(s)),b=await s.saveMember(clinic(s,'second','第二诊室'));
 await s.addReport(a.id,file());await s.addReport(b.id,file());s.setPending('s',s.makeSnapshot(b,['specialty'],[]),b.id);
 await s.deleteMember(b);assert.equal((await s.listReports(b.id)).length,0);assert.equal((await s.listReports(a.id)).length,1);assert.equal(s.getPending('s'),undefined);
 await s.deleteMember(a);assert.equal((await s.listMembers())[0].name,'');assert.equal((await s.listReports(a.id)).length,0);
});
