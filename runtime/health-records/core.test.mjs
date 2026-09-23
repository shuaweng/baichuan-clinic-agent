import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const code=await readFile(new URL('../../config/health-records/core.js',import.meta.url),'utf8');
function store(indexedDB=new IDBFactory()){const ctx=vm.createContext({indexedDB,crypto:{randomUUID},structuredClone,Date,Uint8Array,console});return vm.runInContext(code+';bcHealth',ctx);}
const file=(name='report.pdf',type='application/pdf',data='%PDF-1.7\nlocal isolated test')=>new File([data],name,{type});
test('profiles persist across store instances; absent data stays unknown; stale writes cannot overwrite',async()=>{
 const idb=new IDBFactory(),s=store(idb);const [self]=await s.listMembers();assert.equal(self.allergies,'');assert.equal(self.revision,0);
 const saved=await s.saveMember({...self,sex:'女',weight:'55.2',allergies:'用户记录：青霉素过敏，待核实'});
 assert.equal((await store(idb).listMembers())[0].allergies,saved.allergies);
 await assert.rejects(s.saveMember({...self,weight:'60'}),/其他页面/);
 assert.equal((await s.listMembers())[0].weight,'55.2');
});
test('invalid dates, impossible measurements and oversized notes do not persist',async()=>{
 const s=store(),m=s.emptyMember();for(const change of [{birthDate:'2020-02-31'},{birthDate:'2999-01-01'},{weight:'-1'},{height:'abc'},{conditions:'a'.repeat(2001)}])await assert.rejects(s.saveMember({...m,...change}));
 assert.equal((await s.listMembers())[0].revision,0);
});
test('report storage validates real file signatures, separates members, and preserves blobs and summaries',async()=>{
 const s=store(),self=await s.saveMember(s.emptyMember()),child=await s.saveMember(s.emptyMember('child','孩子','孩子'));
 await assert.rejects(s.addReport(self.id,file('bad.pdf','application/pdf','<script>alert(1)</script>')),/有效/);
 await assert.rejects(s.addReport(self.id,file('bad.svg','image/svg+xml','<svg/>')),/有效/);
 const r=await s.addReport(child.id,file());assert.equal((await s.listReports(self.id)).length,0);assert.equal((await s.listReports(child.id)).length,1);
 await assert.rejects(s.getReport(r.id,self.id),/不存在/);
 const saved=await s.updateReport({...r,summary:'报告要点：用户转述，不代表自动识别。'});assert.equal(saved.revision,2);
 await assert.rejects(s.updateReport({...r,summary:'过期编辑'}),/变更/);
 assert.match(await (await s.getReport(r.id,child.id)).blob.text(),/%PDF/);
 await s.deleteReport(r.id,child.id);assert.equal((await s.listReports(child.id)).length,0);
});
test('consent snapshots contain only selected fields and selected same-member summaries, never raw blobs',()=>{
 const s=store(),self={...s.emptyMember(),sex:'女',allergies:'过敏记录',conditions:'不应发送'};
 const snap=s.makeSnapshot(self,['sex','allergies','not_a_field'],[{memberId:'other',summary:'其他人秘密'},{memberId:'self',name:'报告',summary:'用户填写'}]);
 const out=JSON.stringify(snap);assert.match(out,/过敏记录/);assert.ok(!out.includes('不应发送')&&!out.includes('其他人秘密')&&!out.includes('blob'));assert.equal(snap.用户填写的报告要点.length,1);
 assert.throws(()=>s.makeSnapshot(s.emptyMember(),[],[]),/至少一项/);
});
test('no opt-in and another session send no records; successful consent is consumed once; failure keeps it retryable',async()=>{
 const s=store(),snap=s.makeSnapshot({...s.emptyMember(),allergies:'用户记录'},['allergies'],[]);let texts=[];
 const send=async text=>{texts.push(text);return {kind:'success'};};
 await s.withContext('s1','问题',send);assert.equal(texts.pop(),'问题');
 s.setPending('s1',snap,'self');await s.withContext('s2','其他会话',send);assert.equal(texts.pop(),'其他会话');
 const outcome=await s.withContext('s1','问题',async text=>{assert.match(text,/用户记录/);return {kind:'error'};});assert.equal(outcome.kind,'error');assert.ok(s.getPending('s1'));
 await assert.rejects(s.withContext('s1','问题',async()=>{throw new Error('transport');}),/transport/);assert.equal(s.getPending('s1').inFlight,false);
 await s.withContext('s1','问题',send);assert.match(texts.pop(),/用户记录/);assert.equal(s.getPending('s1'),undefined);
 await s.withContext('s1','后续问题',send);assert.equal(texts.pop(),'后续问题');
});
test('snapshot is immutable, explicitly retractable and protected during an in-flight send',async()=>{
 const s=store(),snap=s.makeSnapshot({...s.emptyMember(),allergies:'原始记录'},['allergies'],[]);s.setPending('session',snap,'self');snap.用户填写的健康信息.过敏史='更改';
 let release;const task=s.withContext('session','问题',text=>{assert.match(text,/原始记录/);return new Promise(resolve=>release=resolve);});
 assert.throws(()=>s.setPending('session',null),/正在发送/);await assert.rejects(s.withContext('session','另一个问题',async()=>({kind:'success'})),/发送中/);
 release({kind:'error'});await task;s.setPending('session',null);assert.equal(s.getPending('session'),undefined);
});
test('removing a member deletes only that member’s files and pending contexts; self can be cleared',async()=>{
 const s=store(),self=await s.saveMember({...s.emptyMember(),allergies:'本人记录'}),child=await s.saveMember({...s.emptyMember('child','孩子','孩子'),conditions:'孩子记录'});
 await s.addReport(self.id,file());await s.addReport(child.id,file());s.setPending('s1',s.makeSnapshot(child,['conditions'],[]),'child');s.setPending('s2',s.makeSnapshot(self,['allergies'],[]),'self');
 await s.deleteMember(child);assert.equal((await s.listMembers()).length,1);assert.equal((await s.listReports('child')).length,0);assert.equal((await s.listReports('self')).length,1);assert.equal(s.getPending('s1'),undefined);assert.ok(s.getPending('s2'));
 await s.deleteMember(self);assert.equal((await s.listMembers())[0].allergies,'');assert.equal((await s.listReports('self')).length,0);assert.equal(s.getPending('s2'),undefined);
});
