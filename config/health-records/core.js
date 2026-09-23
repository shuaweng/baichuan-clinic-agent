// Injected into the pinned DSH client factory. No health information leaves this store by itself.
function createHealthRecords(env) {
  const { indexedDB, crypto } = env;
  const fields = { birthDate:'出生日期', sex:'性别', height:'身高（cm）', weight:'体重（kg）', allergies:'过敏史', conditions:'既往病史', medications:'当前用药', pregnancy:'孕哺状态' };
  const emptyMember = (id='self', name='本人', relation='本人') => ({id,name,relation,revision:0,...Object.fromEntries(Object.keys(fields).map(k=>[k,'']))});
  let database;
  function db(){
    if(!database)database=new Promise((resolve,reject)=>{
      if(!indexedDB){reject(new Error('此浏览器无法保存档案，请使用支持本地存储的浏览器。'));return;}
      const request=indexedDB.open('baichuan-health-records',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('members',{keyPath:'id'});request.result.createObjectStore('reports',{keyPath:'id'}).createIndex('memberId','memberId');};
      request.onsuccess=()=>{const result=request.result;result.onversionchange=()=>{result.close();database=null;};resolve(result);};
      request.onerror=()=>{database=null;reject(new Error('无法打开健康档案存储。请检查浏览器存储权限。'));};
      request.onblocked=()=>{database=null;reject(new Error('请关闭其他正在使用档案的旧页面后重试。'));};
    });
    return database;
  }
  async function transact(stores,mode,work){
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction(stores,mode);let result,reason;
      const fail=message=>{reason=new Error(message);tx.abort();};
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(reason??new Error(tx.error?.name==='QuotaExceededError'?'浏览器存储空间不足，请先移除不需要的资料。':'保存失败，原有档案未修改。'));
      tx.onerror=()=>{};
      try{work(tx,value=>{result=value;},fail);}catch(error){reason=error;tx.abort();}
    });
  }
  function validate(member){
    if(!member.name?.trim()||member.name.trim().length>30)throw new Error('请填写 1–30 字的成员称呼。');
    if(!['本人','孩子','配偶','父母','其他'].includes(member.relation))throw new Error('请选择成员关系。');
    if(member.birthDate){const date=new Date(member.birthDate+'T00:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(member.birthDate)||!Number.isFinite(+date)||date.getFullYear()<1900||date.getFullYear()!==+member.birthDate.slice(0,4)||date.getMonth()+1!==+member.birthDate.slice(5,7)||date.getDate()!==+member.birthDate.slice(8,10)||date>new Date())throw new Error('请填写有效的出生日期，且不能晚于今天。');}
    for(const [key,max] of [['height',300],['weight',700]])if(member[key]!==''&&(!Number.isFinite(Number(member[key]))||Number(member[key])<=0||Number(member[key])>max))throw new Error(`请检查${fields[key]}。`);
    if(!['','女','男','其他 / 不便透露'].includes(member.sex))throw new Error('请选择有效的性别选项。');
    for(const key of Object.keys(fields))if(typeof member[key]!=='string'||member[key].length>2000)throw new Error('每项健康记录请控制在 2000 字以内。');
  }
  async function listMembers(){const all=await transact(['members'],'readonly',(tx,done)=>{tx.objectStore('members').getAll().onsuccess=e=>done(e.target.result);});return all.some(m=>m.id==='self')?all:[emptyMember(),...all];}
  async function saveMember(member){
    validate(member);
    return transact(['members'],'readwrite',(tx,done,fail)=>{
      const store=tx.objectStore('members');store.get(member.id).onsuccess=e=>{
        const old=e.target.result;
        if((old?.revision??0)!==member.revision){fail('档案已在其他页面更新。请关闭后重新打开，再进行编辑。');return;}
        const next={id:member.id,name:member.name.trim(),relation:member.relation,revision:member.revision+1,updatedAt:new Date().toISOString(),...Object.fromEntries(Object.keys(fields).map(k=>[k,member[k].trim()]))};
        store.put(next);done(next);
      };
    });
  }
  async function listReports(memberId){return transact(['reports'],'readonly',(tx,done)=>{tx.objectStore('reports').index('memberId').getAll(memberId).onsuccess=e=>done(e.target.result.map(({blob,...metadata})=>metadata).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));});}
  async function validateFile(file){
    if(file.size===0||file.size>10*1024*1024)throw new Error('单份资料需大于 0 且不超过 10 MB。');
    const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
    const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
    const valid=(file.type==='application/pdf'&&ascii(0,5)==='%PDF-')||(file.type==='image/png'&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))||(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)||(file.type==='image/webp'&&ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP');
    if(!valid)throw new Error('请选择有效的 JPG、PNG、WebP 图片或 PDF 文件。');
  }
  async function addReport(memberId,file){
    await validateFile(file);
    return transact(['members','reports'],'readwrite',(tx,done,fail)=>{
      tx.objectStore('members').get(memberId).onsuccess=e=>{
        if(!e.target.result){fail('请先保存当前成员，再上传资料。');return;}
        const store=tx.objectStore('reports');store.getAll().onsuccess=e=>{
          const all=e.target.result;
          if(all.filter(r=>r.memberId===memberId).length>=30){fail('每位成员最多保存 30 份资料。');return;}
          if(all.reduce((n,r)=>n+r.size,0)+file.size>100*1024*1024){fail('档案资料总容量已达到 100 MB，请先移除不需要的资料。');return;}
          const report={id:crypto.randomUUID(),memberId,name:file.name.slice(0,180),type:file.type,size:file.size,blob:file,summary:'',revision:1,createdAt:new Date().toISOString()};
          store.add(report);const {blob,...meta}=report;done(meta);
        };
      };
    });
  }
  async function updateReport(report){
    if(typeof report.summary!=='string'||report.summary.length>3000)throw new Error('报告要点请控制在 3000 字以内。');
    return transact(['reports'],'readwrite',(tx,done,fail)=>{
      const store=tx.objectStore('reports');store.get(report.id).onsuccess=e=>{const old=e.target.result;
        if(!old||old.memberId!==report.memberId||old.revision!==report.revision){fail('报告已变更，请重新打开档案。');return;}
        const next={...old,summary:report.summary.trim(),revision:old.revision+1};store.put(next);const {blob,...meta}=next;done(meta);
      };
    });
  }
  async function getReport(id,memberId){return transact(['reports'],'readonly',(tx,done,fail)=>{tx.objectStore('reports').get(id).onsuccess=e=>{const r=e.target.result;if(!r||r.memberId!==memberId){fail('资料不存在或已移除。');return;}done(r);};});}
  async function deleteReport(id,memberId){return transact(['reports'],'readwrite',(tx,done,fail)=>{const store=tx.objectStore('reports');store.get(id).onsuccess=e=>{if(e.target.result?.memberId!==memberId){fail('资料不存在。');return;}store.delete(id);done(true);};});}
  async function deleteMember(member){
    if([...pending.values()].some(p=>p.memberId===member.id&&p.inFlight))throw new Error('此成员档案正在发送，请稍后移除。');
    await transact(['members','reports'],'readwrite',(tx,done,fail)=>{
      const members=tx.objectStore('members');members.get(member.id).onsuccess=e=>{
        if((e.target.result?.revision??0)!==member.revision){fail('档案已在其他页面更新，请重新打开。');return;}
        const reports=tx.objectStore('reports');reports.index('memberId').getAllKeys(member.id).onsuccess=e=>{for(const id of e.target.result)reports.delete(id);};
        if(member.id==='self')members.put({...emptyMember(),revision:member.revision+1,updatedAt:new Date().toISOString()});else members.delete(member.id);
        done(true);
      };
    });
    for(const [sessionId,p] of pending)if(p.memberId===member.id)pending.delete(sessionId);
    notify();
  }
  const listeners=new Set(),pending=new Map();let version=0;
  const notify=()=>{version++;for(const fn of listeners)fn();};
  function makeSnapshot(member,selectedFields,reports){
    validate(member);
    const health=Object.fromEntries([...new Set(selectedFields)].filter(key=>key in fields&&member[key].trim()).map(key=>[fields[key],member[key].trim()]));
    const summaries=reports.filter(r=>r.memberId===member.id&&r.summary?.trim()).map(r=>({资料名称:r.name,用户填写的报告要点:r.summary.trim()}));
    if(!Object.keys(health).length&&!summaries.length)throw new Error('请先填写并选择至少一项健康信息或报告要点。');
    return {档案对象:member.name,与用户关系:member.relation,用户填写的健康信息:health,用户填写的报告要点:summaries,档案更新日期:member.updatedAt,资料边界:'这是用户选用的资料，不是医生核验的事实。空缺不表示正常；仅提供填写的文字，不包含附件正文或自动识别结果。若当前问题描述的是其他人，请先核对对象，不要混用。'};
  }
  function setPending(sessionId,snapshot,memberId,reportIds=[]){if(!sessionId)throw new Error('请先选择工作区，再将档案用于咨询。');if(pending.get(sessionId)?.inFlight)throw new Error('档案正在发送，请稍后修改。');if(snapshot)pending.set(sessionId,{id:crypto.randomUUID(),snapshot:structuredClone(snapshot),memberId,reportIds:[...reportIds],inFlight:false});else pending.delete(sessionId);notify();}
  function getPending(sessionId){return pending.get(sessionId);}
  async function withContext(sessionId,text,send){
    const item=pending.get(sessionId);if(!item)return send(text);
    if(item.inFlight)throw new Error('档案随上一条消息发送中，请稍候。');
    item.inFlight=true;notify();
    const augmented=text+'\n\n【本次提问选用的健康档案 · 用户填写资料】\n'+JSON.stringify(item.snapshot,null,2)+'\n【健康档案结束】';
    try{const outcome=await send(augmented);if(outcome?.kind==='success'&&pending.get(sessionId)===item)pending.delete(sessionId);return outcome;}
    finally{item.inFlight=false;notify();}
  }
  return {fields,emptyMember,listMembers,saveMember,listReports,addReport,updateReport,getReport,deleteReport,deleteMember,validate,validateFile,makeSnapshot,setPending,getPending,withContext,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},getVersion:()=>version};
}
const bcHealth = createHealthRecords({indexedDB:globalThis.indexedDB,crypto:globalThis.crypto});
