// React component injected beside the DSH composer; renders its modal through a body portal.
const bcH = (...args) => react.createElement(...args);
function BcHealthIcon({name='folder',size=20}) {
  const paths={folder:['M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z','M8 13h8M12 9v8'],user:['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z','M4 21v-2a8 8 0 0 1 16 0v2Z'],allergies:['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z','M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1'],conditions:['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z','M9 11h6m-3-3v6'],medications:['m8 4-4 4a5 5 0 0 0 0 7l5 5a5 5 0 0 0 7 0l4-4a5 5 0 0 0 0-7l-5-5a5 5 0 0 0-7 0Z','m6 6 12 12'],pregnancy:['M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z','M8 22v-6l-3 1 4-7h6l4 7-3-1v6M9 13v5h6v-5'],report:['M14 2H5v20h14V7Z','M14 2v5h5M8 12h8m-8 4h5'],check:['m5 12 4 4L19 6']};
  return bcH('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},...(paths[name]??paths.folder).map((d,i)=>bcH('path',{d,key:i})));
}
function BcHealthEntry({sessionId}) {
  react.useSyncExternalStore(bcHealth.subscribe,bcHealth.getVersion,bcHealth.getVersion);
  const [open,setOpen]=react.useState(false),[error,setError]=react.useState('');
  const pending=bcHealth.getPending(sessionId);
  return bcH(react.Fragment,null,
    bcH('div',{className:'bc-health-entry',onClick:e=>e.stopPropagation()},
      bcH('button',{type:'button',className:'bc-health-trigger','aria-haspopup':'dialog',onClick:()=>setOpen(true)},bcH(BcHealthIcon,{}),'我的健康档案'),
      pending&&bcH('div',{className:'bc-health-armed',role:'status'},bcH('span',null,`${pending.snapshot.档案对象} · ${pending.inFlight?'发送中':'下次提问使用'}`),bcH('button',{type:'button',disabled:pending.inFlight,'aria-label':'取消本次使用健康档案',onClick:()=>{try{bcHealth.setPending(sessionId,null);}catch(e){setError(e.message);}}},'×')),
      error&&bcH('span',{role:'alert'},error)),
    open&&react_dom.createPortal(bcH(BcHealthDrawer,{sessionId,onClose:()=>setOpen(false)}),document.body));
}
function BcHealthDrawer({sessionId,onClose}) {
  const dialog=react.useRef(null),fileInput=react.useRef(null),titleRef=react.useRef(null),op=react.useRef(0);
  const [members,setMembers]=react.useState([]),[draft,setDraft]=react.useState(null),[reports,setReports]=react.useState([]);
  const [tab,setTab]=react.useState('overview'),[editing,setEditing]=react.useState(false),[expanded,setExpanded]=react.useState('');
  const [busy,setBusy]=react.useState(true),[error,setError]=react.useState(''),[notice,setNotice]=react.useState(''),[dirty,setDirty]=react.useState(false);
  const [useForChat,setUseForChat]=react.useState(false),[selectedFields,setSelectedFields]=react.useState(new Set(Object.keys(bcHealth.fields))),[selectedReports,setSelectedReports]=react.useState(new Set());
  const [preview,setPreview]=react.useState(null);
  const label={...bcHealth.fields,height:'身高',weight:'体重'};
  const close=()=>{if(busy)return;if(dirty&&!window.confirm('还有未保存的编辑，确定放弃并关闭吗？'))return;onClose();};
  react.useEffect(()=>{const previous=document.activeElement;dialog.current.showModal();titleRef.current?.focus();return()=>{op.current++;previous?.focus?.();};},[]);
  react.useEffect(()=>{let alive=true;bcHealth.listMembers().then(async all=>{const p=bcHealth.getPending(sessionId);const member=all.find(m=>m.id===p?.memberId)??all.find(m=>m.id==='self');const files=await bcHealth.listReports(member.id);if(!alive)return;setMembers(all);setDraft(member);setReports(files);setUseForChat(!!p);if(p){setSelectedFields(new Set(Object.keys(bcHealth.fields).filter(k=>bcHealth.fields[k] in p.snapshot.用户填写的健康信息)));setSelectedReports(new Set((p.reportIds??[]).filter(id=>files.some(r=>r.id===id))));}setBusy(false);}).catch(e=>{if(alive){setError(e.message);setBusy(false);}});return()=>{alive=false;};},[sessionId]);
  react.useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  const change=(key,value)=>{setDraft(d=>({...d,[key]:value}));setDirty(true);setError('');setNotice('');};
  const toggleField=key=>{setSelectedFields(old=>{const next=new Set(old);next.has(key)?next.delete(key):next.add(key);return next;});setDirty(true);};
  async function switchMember(id){
    if(busy||id===draft.id)return;
    if(dirty&&!window.confirm('切换成员会放弃未保存的编辑，是否继续？'))return;
    setBusy(true);setError('');const token=++op.current;
    try{const files=await bcHealth.listReports(id);if(token!==op.current)return;setDraft(members.find(m=>m.id===id));setReports(files);setSelectedReports(new Set());setSelectedFields(new Set(Object.keys(bcHealth.fields)));setUseForChat(false);setDirty(false);setEditing(false);setExpanded('');setPreview(null);setNotice('');}catch(e){setError(e.message);}finally{if(token===op.current)setBusy(false);}
  }
  function addMember(){
    if(dirty&&!window.confirm('添加成员会放弃未保存的编辑，是否继续？'))return;
    setDraft(bcHealth.emptyMember(crypto.randomUUID(),'','孩子'));setReports([]);setSelectedReports(new Set());setSelectedFields(new Set(Object.keys(bcHealth.fields)));setUseForChat(false);setDirty(true);setEditing(true);setExpanded('');setTab('overview');setPreview(null);setError('');setNotice('');
  }
  async function save(){
    if(busy)return;setError('');setNotice('');setBusy(true);
    try{
      // Validate the intended snapshot before persisting; nothing is sent by saving.
      if(useForChat){if(!sessionId)throw new Error('请先选择工作区，再将档案用于咨询。');bcHealth.makeSnapshot(draft,[...selectedFields],reports.filter(r=>selectedReports.has(r.id)));}
      if(bcHealth.getPending(sessionId)?.inFlight)throw new Error('档案正在随消息发送，请稍后保存。');
      const saved=await bcHealth.saveMember(draft);setDraft(saved);setMembers(all=>[...all.filter(m=>m.id!==saved.id),saved].sort((a,b)=>a.id==='self'?-1:b.id==='self'?1:0));
      const next=[];
      for(const r of reports){const persisted=r.dirty?await bcHealth.updateReport(r):r;next.push(persisted);setReports(old=>old.map(x=>x.id===persisted.id?persisted:x));}
      if(sessionId)bcHealth.setPending(sessionId,useForChat?bcHealth.makeSnapshot(saved,[...selectedFields],next.filter(r=>selectedReports.has(r.id))):null,saved.id,[...selectedReports]);
      setDirty(false);setEditing(false);setExpanded('');setNotice(useForChat?'档案已保存，所选信息将随下一条消息发送。':'档案已保存。');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function upload(files){
    if(busy||!files.length)return;setBusy(true);setError('');setNotice('');let owner=draft;
    try{
      if(owner.revision===0){owner=await bcHealth.saveMember(owner);setDraft(owner);setMembers(all=>[...all.filter(m=>m.id!==owner.id),owner]);}
      let count=0;
      for(const file of files){const r=await bcHealth.addReport(owner.id,file);setReports(old=>[r,...old]);count++;}
      setNotice(`已保存 ${count} 份资料。填写报告要点后，可选择用于咨询。`);setTab('reports');
    }catch(e){setError(e.message);}finally{setBusy(false);if(fileInput.current)fileInput.current.value='';}
  }
  async function previewReport(report){setError('');try{const r=await bcHealth.getReport(report.id,draft.id);setPreview({name:r.name,type:r.type,url:URL.createObjectURL(r.blob)});}catch(e){setError(e.message);}}
  async function removeMember(){
    if(!window.confirm(draft.id==='self'?'清空本人的健康信息与报告文件？此操作无法撤销。':`移除“${draft.name||'新成员'}”及其全部报告文件？此操作无法撤销。`))return;
    setBusy(true);setError('');
    try{await bcHealth.deleteMember(draft);const all=await bcHealth.listMembers();const self=all.find(m=>m.id==='self');setMembers(all);setDraft(self);setReports(await bcHealth.listReports(self.id));setUseForChat(false);setSelectedReports(new Set());setSelectedFields(new Set(Object.keys(bcHealth.fields)));setDirty(false);setEditing(false);setExpanded('');setNotice('档案及相关资料已移除。');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function removeReport(report){
    if(!window.confirm(`移除“${report.name}”？此操作会删除本浏览器保存的文件。`))return;
    setBusy(true);setError('');try{if(bcHealth.getPending(sessionId)?.inFlight)throw new Error('档案正在发送，请稍后移除资料。');await bcHealth.deleteReport(report.id,draft.id);setReports(old=>old.filter(r=>r.id!==report.id));setSelectedReports(old=>new Set([...old].filter(id=>id!==report.id)));if(bcHealth.getPending(sessionId)?.memberId===draft.id){bcHealth.setPending(sessionId,null);setUseForChat(false);}setNotice('资料已移除。如需用于咨询，请重新选择并保存。');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const sectionTitle=(text,action)=>bcH('div',{className:'bc-health-section-title'},bcH('h3',null,text),action);
  const textButton=(text,fn,props={})=>bcH('button',{type:'button',className:'bc-health-link',disabled:busy,onClick:fn,...props},text);
  const selectBox=(text,checked,fn,disabled=false)=>bcH('label',{className:'bc-health-selection'},bcH('input',{type:'checkbox',checked,disabled:busy||disabled,onChange:fn}),text);
  const reportUpload=bcH('div',{className:'bc-health-upload'},bcH(BcHealthIcon,{name:'report',size:26}),bcH('div',null,bcH('strong',null,'上传检查报告或病历'),bcH('small',null,'图片、PDF · 单份不超过 10 MB')),bcH('button',{type:'button',disabled:busy,onClick:()=>fileInput.current.click()},'上传资料'));
  function basicValue(key){const value=draft[key];return value?(key==='height'?value+' cm':key==='weight'?value+' kg':value):'未填写';}
  return bcH('dialog',{ref:dialog,className:'bc-health-drawer','aria-labelledby':'bc-health-title',onCancel:e=>{e.preventDefault();close();},onClick:e=>{if(e.target===dialog.current){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left)close();}}},
    bcH('header',{className:'bc-health-header'},bcH(BcHealthIcon,{size:29}),bcH('div',null,bcH('h2',{id:'bc-health-title',tabIndex:-1,ref:titleRef},'我的健康档案'),bcH('p',null,'管理健康信息，咨询时按需使用')),bcH('button',{type:'button',className:'bc-health-close','aria-label':'关闭健康档案',disabled:busy,onClick:close},'×')),
    bcH('div',{className:'bc-health-body'},
      error&&bcH('div',{className:'bc-health-error',role:'alert'},error),notice&&bcH('div',{className:'bc-health-notice',role:'status'},bcH(BcHealthIcon,{name:'check',size:16}),notice),
      !draft?bcH('p',null,busy?'正在读取档案…':'档案未能打开，请关闭后重试。'):bcH(react.Fragment,null,
        bcH('div',{className:'bc-health-owner'},bcH(BcHealthIcon,{name:'user'}),bcH('span',null,'当前档案'),bcH('select',{'aria-label':'当前档案成员',value:draft.id,disabled:busy,onChange:e=>switchMember(e.target.value)},...(!members.some(m=>m.id===draft.id)?[bcH('option',{key:draft.id,value:draft.id},draft.name||'新成员')]:[]),...members.map(m=>bcH('option',{key:m.id,value:m.id},m.name))),textButton('+ 添加成员',addMember)),
        bcH('nav',{className:'bc-health-tabs','aria-label':'档案栏目'},...['overview','reports'].map(t=>bcH('button',{type:'button',key:t,'aria-pressed':tab===t,onClick:()=>setTab(t)},t==='overview'?'健康概览':`报告资料${reports.length?' · '+reports.length:''}`))),
        tab==='overview'?bcH(react.Fragment,null,
          bcH('section',null,sectionTitle('基本信息',textButton(editing?'收起编辑':'编辑',()=>setEditing(!editing))),
            editing&&bcH('div',{className:'bc-health-grid bc-health-name'},bcH('label',null,'成员称呼',bcH('input',{value:draft.name,maxLength:30,disabled:busy,onChange:e=>change('name',e.target.value)})),bcH('label',null,'与我的关系',bcH('select',{value:draft.relation,disabled:busy||draft.id==='self',onChange:e=>change('relation',e.target.value)},...['本人','孩子','配偶','父母','其他'].map(v=>bcH('option',{key:v,value:v},v))))),
            bcH('div',{className:'bc-health-grid'},...['birthDate','sex','height','weight'].map(key=>bcH('div',{key,className:'bc-health-tile'},editing?bcH('label',null,label[key],key==='sex'?bcH('select',{value:draft[key],disabled:busy,onChange:e=>change(key,e.target.value)},...['','女','男','其他 / 不便透露'].map(v=>bcH('option',{key:v,value:v},v||'请选择'))):bcH('input',{type:key==='birthDate'?'date':'number',value:draft[key],disabled:busy,min:key==='birthDate'?'1900-01-01':'0.01',step:key==='birthDate'?undefined:'0.1',max:key==='height'?300:key==='weight'?700:new Date().toLocaleDateString('en-CA'),onChange:e=>change(key,e.target.value)})):bcH('button',{type:'button',onClick:()=>setEditing(true)},bcH('small',null,label[key]),bcH('span',{className:draft[key]?'':'bc-health-muted'},basicValue(key))),useForChat&&selectBox('用于本次咨询',selectedFields.has(key),()=>toggleField(key),!draft[key]))))),
          editing&&bcH('div',{className:'bc-health-remove-member'},textButton(draft.id==='self'?'清空本人档案':'移除此成员',removeMember)),
          bcH('section',null,sectionTitle('重要健康信息'),...['allergies','conditions','medications','pregnancy'].map(key=>bcH('div',{key,className:'bc-health-condition'},bcH('button',{type:'button',className:'bc-health-condition-row','aria-expanded':expanded===key,onClick:()=>setExpanded(expanded===key?'':key)},bcH(BcHealthIcon,{name:key}),bcH('span',null,label[key]),bcH('small',{className:draft[key]?'':'bc-health-muted'},draft[key]||'未记录'),bcH('span',null,'›')),expanded===key&&bcH('label',{className:'bc-health-condition-editor'},label[key],bcH('textarea',{value:draft[key],disabled:busy,maxLength:2000,rows:3,placeholder:key==='allergies'?'记录过敏物质、反应和时间；不确定可写“待核实”':key==='medications'?'记录药名、剂量和使用时间；不确定可注明':key==='pregnancy'?'按实际情况记录备孕、孕期、哺乳或其他状态':'记录已知病史、时间和相关处理',onChange:e=>change(key,e.target.value)})),useForChat&&draft[key]&&selectBox('用于本次咨询',selectedFields.has(key),()=>toggleField(key))))),
          bcH('section',null,sectionTitle('检查与就诊资料',textButton('查看全部 ›',()=>setTab('reports'))),reportUpload,reports.length>0&&bcH('p',{className:'bc-health-hint'},`已保存 ${reports.length} 份资料。前往“报告资料”填写要点、选择本次使用的内容。`))
        ):bcH('section',null,sectionTitle('检查与就诊资料'),reportUpload,bcH('p',{className:'bc-health-hint'},'文件保存在此浏览器。填写的报告要点可用于咨询，文件正文不会自动识别或发送。'),reports.length===0&&bcH('div',{className:'bc-health-empty'},bcH(BcHealthIcon,{name:'report',size:34}),bcH('strong',null,'还没有保存资料'),bcH('p',null,'可以添加化验单、检查报告或就诊病历。')),...reports.map(r=>bcH('article',{className:'bc-health-report',key:r.id},bcH('div',{className:'bc-health-report-title'},bcH(BcHealthIcon,{name:'report'}),bcH('strong',null,r.name),bcH('small',null,`${(r.size/1024/1024).toFixed(1)} MB`)),bcH('div',{className:'bc-health-report-actions'},textButton('预览',()=>previewReport(r)),textButton('移除',()=>removeReport(r))),bcH('label',null,'报告要点',bcH('textarea',{value:r.summary,rows:3,maxLength:3000,disabled:busy,placeholder:'填写日期、检查项目、结果、单位和参考范围，供本次咨询参考',onChange:e=>{setReports(old=>old.map(x=>x.id===r.id?{...x,summary:e.target.value,dirty:true}:x));setDirty(true);}})),useForChat&&selectBox(r.summary.trim()?'将此报告要点用于本次咨询':'填写要点后可用于咨询',selectedReports.has(r.id),()=>{setSelectedReports(old=>{const n=new Set(old);n.has(r.id)?n.delete(r.id):n.add(r.id);return n;});setDirty(true);},!r.summary.trim())))),
        bcH('p',{className:'bc-health-storage'},'档案保存在当前浏览器，清除网站数据会移除这些资料。'))),
    bcH('footer',{className:'bc-health-footer'},selectBox('本次咨询使用此档案',useForChat,()=>{setUseForChat(!useForChat);setDirty(true);},!sessionId||!draft),bcH('p',null,sessionId?'保存后，所选信息随下一条消息发送；已发送内容会留在会话中。':'先选择工作区，即可将档案用于本次咨询。'),bcH('div',null,bcH('button',{type:'button',disabled:busy,onClick:close},'关闭'),bcH('button',{type:'button',className:'bc-health-primary',disabled:busy||!draft,onClick:save},busy?'处理中…':'保存档案'))),
    bcH('input',{type:'file',ref:fileInput,hidden:true,multiple:true,accept:'.pdf,.png,.jpg,.jpeg,.webp',onChange:e=>upload([...e.target.files])}),
    preview&&bcH('div',{className:'bc-health-preview'},bcH('header',null,bcH('strong',null,preview.name),textButton('返回档案',()=>setPreview(null))),preview.type==='application/pdf'?bcH('iframe',{src:preview.url,title:preview.name,sandbox:''}):bcH('img',{src:preview.url,alt:preview.name}),bcH('a',{href:preview.url,download:preview.name},'下载原文件')));
}
