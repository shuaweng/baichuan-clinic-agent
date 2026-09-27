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
      bcH('button',{type:'button',className:'bc-health-trigger','aria-haspopup':'dialog',onClick:()=>setOpen(true)},bcH(BcHealthIcon,{}),'我的诊室档案',bcH('svg',{className:'bc-health-entry-chevron',width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},bcH('path',{d:'m9 5 7 7-7 7'}))),
      pending&&bcH('div',{className:'bc-health-armed',role:'status'},bcH('span',null,`${pending.snapshot.档案对象} · ${pending.inFlight?'发送中':'下次提问使用'}`),bcH('button',{type:'button',disabled:pending.inFlight,'aria-label':'取消本次使用诊室档案',onClick:()=>{try{bcHealth.setPending(sessionId,null);}catch(e){setError(e.message);}}},'×')),
      error&&bcH('span',{className:'bc-health-entry-error',role:'alert'},error)),
    open&&react_dom.createPortal(bcH(BcHealthDrawer,{sessionId,onClose:()=>setOpen(false)}),document.body));
}
function BcHealthDrawer({sessionId,onClose}) {
  const dialog=react.useRef(null),fileInput=react.useRef(null),titleRef=react.useRef(null);
  const [members,setMembers]=react.useState([]),[draft,setDraft]=react.useState(null),[reports,setReports]=react.useState([]);
  const [tab,setTab]=react.useState('overview'),[busy,setBusy]=react.useState(true),[dirty,setDirty]=react.useState(false);
  const [error,setError]=react.useState(''),[notice,setNotice]=react.useState(''),[preview,setPreview]=react.useState(null);
  const [useForChat,setUseForChat]=react.useState(false),[selectedFields,setSelectedFields]=react.useState(new Set(Object.keys(bcHealth.fields))),[selectedReports,setSelectedReports]=react.useState(new Set());
  const close=()=>{if(busy)return;if(dirty&&!window.confirm('还有未保存的编辑，确定放弃并关闭吗？'))return;onClose();};
  react.useEffect(()=>{const previous=document.activeElement;dialog.current.showModal();titleRef.current?.focus();return()=>previous?.focus?.();},[]);
  react.useEffect(()=>{let alive=true;(async()=>{
    const all=await bcHealth.listMembers(),pending=bcHealth.getPending(sessionId);
    let preferred;try{preferred=JSON.parse(window.localStorage?.getItem('baichuan-clinic-selection')||'null')?.id;}catch{}
    const member=all.find(m=>m.id===pending?.memberId)??all.find(m=>m.id===preferred)??all[0];
    const files=await bcHealth.listReports(member.id);if(!alive)return;
    setMembers(all);setDraft(member);setReports(files);setUseForChat(!!pending);
    if(pending){setSelectedFields(new Set(Object.keys(bcHealth.fields).filter(k=>bcHealth.fields[k] in pending.snapshot.诊室信息)));setSelectedReports(new Set(pending.reportIds??[]));}
    setBusy(false);
  })().catch(e=>{if(alive){setError(e.message);setBusy(false);}});return()=>{alive=false;};},[sessionId]);
  react.useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  const edited=()=>{setDirty(true);setError('');setNotice('');};
  const change=(key,value)=>{setDraft(old=>({...old,[key]:value}));edited();};
  const changeReport=(id,key,value)=>{setReports(old=>old.map(r=>r.id===id?{...r,[key]:value,dirty:true}:r));edited();};
  const toggle=(setter,key)=>{setter(old=>{const next=new Set(old);next.has(key)?next.delete(key):next.add(key);return next;});edited();};
  const remember=member=>{try{window.localStorage?.setItem('baichuan-clinic-selection',JSON.stringify({id:member.id,specialty:member.specialty}));}catch{}};
  const reset=(member,files)=>{setDraft(member);setReports(files);setUseForChat(false);setSelectedFields(new Set(Object.keys(bcHealth.fields)));setSelectedReports(new Set());setDirty(false);setPreview(null);setNotice('');setError('');};
  async function switchMember(id){
    if(busy||id===draft.id)return;if(dirty&&!window.confirm('切换诊室会放弃未保存的编辑，是否继续？'))return;
    setBusy(true);setError('');try{
      const files=await bcHealth.listReports(id),member=members.find(m=>m.id===id);
      if(sessionId)bcHealth.setPending(sessionId,null);
      reset(member,files);if(member.revision)remember(member);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function addMember(){
    if(dirty&&!window.confirm('添加诊室会放弃未保存的编辑，是否继续？'))return;
    try{if(sessionId)bcHealth.setPending(sessionId,null);}catch(e){setError(e.message);return;}
    reset(bcHealth.emptyMember(crypto.randomUUID()),[]);setTab('overview');setDirty(true);
  }
  async function save(){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{
      bcHealth.validate(draft);for(const r of reports)if(r.dirty)bcHealth.validateReport(r);
      if(useForChat){if(!sessionId)throw new Error('请先选择工作区，再将档案用于对话。');bcHealth.makeSnapshot(draft,[...selectedFields],reports.filter(r=>selectedReports.has(r.id)));}
      if(bcHealth.getPending(sessionId)?.inFlight)throw new Error('档案正在发送，请稍后保存。');
      const saved=await bcHealth.saveMember(draft);setDraft(saved);setMembers(old=>[...old.filter(m=>m.id!==saved.id),saved]);
      const next=[];for(const r of reports){const persisted=r.dirty?await bcHealth.updateReport(r):r;next.push(persisted);setReports(old=>old.map(x=>x.id===persisted.id?persisted:x));}
      const ids=[...selectedReports].filter(id=>next.some(r=>r.id===id&&r.status==='可供 Agent 引用'));
      if(sessionId)bcHealth.setPending(sessionId,useForChat?bcHealth.makeSnapshot(saved,[...selectedFields],next.filter(r=>ids.includes(r.id))):null,saved.id,ids);
      setSelectedReports(new Set(ids));setDirty(false);remember(saved);setNotice(useForChat?'已保存，所选内容将随下一条消息使用。':'诊室档案已保存。');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function upload(files){
    if(busy||!files.length)return;
    if(!draft.revision||dirty){setError('请先保存当前编辑，再上传资料。');fileInput.current.value='';return;}
    setBusy(true);setError('');let count=0;
    try{const owner=draft;for(const file of files){const r=await bcHealth.addReport(owner.id,file);setReports(old=>[r,...old]);count++;}setNotice(`已上传 ${count} 份资料。请填写来源、版本和确认要点后启用引用。`);}
    catch(e){setError((count?`已上传 ${count} 份；`:'')+e.message);}finally{setBusy(false);if(fileInput.current)fileInput.current.value='';}
  }
  async function previewReport(report){setError('');try{const r=await bcHealth.getReport(report.id,draft.id);setPreview({name:r.name,type:r.type,url:URL.createObjectURL(r.blob)});}catch(e){setError(e.message);}}
  async function removeReport(report){
    if(!window.confirm(`移除“${report.title}”及其本地文件？此操作无法撤销。`))return;
    setBusy(true);setError('');try{await bcHealth.deleteReport(report.id,draft.id);setReports(old=>old.filter(r=>r.id!==report.id));setSelectedReports(old=>new Set([...old].filter(id=>id!==report.id)));setUseForChat(false);setNotice('资料已移除。');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function removeMember(){
    if(!window.confirm(`移除“${draft.name||'未命名诊室'}”及其全部资料？此操作无法撤销。`))return;
    setBusy(true);setError('');try{await bcHealth.deleteMember(draft);const all=await bcHealth.listMembers();setMembers(all);reset(all[0],await bcHealth.listReports(all[0].id));try{window.localStorage?.removeItem('baichuan-clinic-selection');}catch{}setTab('overview');setNotice('诊室档案及资料已移除。');}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const textButton=(text,fn,props={})=>bcH('button',{type:'button',className:'bc-health-link',disabled:busy,onClick:fn,...props},text);
  const check=(text,checked,fn,disabled=false)=>bcH('label',{className:'bc-health-selection'},bcH('input',{type:'checkbox',checked,disabled:busy||disabled,onChange:fn}),text);
  const sectionTitle=(text,caption)=>bcH('div',{className:'bc-clinic-section-title'},bcH('h3',null,text),caption&&bcH('p',null,caption));
  const field=(key,{label=bcHealth.fields[key],options,placeholder='',wide=false,multiline=false,required=false}={})=>bcH('div',{className:'bc-clinic-field'+(wide?' bc-clinic-wide':''),key},
    bcH('label',null,bcH('span',null,label,required&&bcH('em',null,' *')),
      options?bcH('select',{'data-clinic-field':key,value:draft[key],disabled:busy,onChange:e=>change(key,e.target.value)},bcH('option',{value:''},'请选择'),...options.map(v=>bcH('option',{key:v,value:v},v))):
      bcH(multiline?'textarea':'input',{'data-clinic-field':key,value:draft[key],disabled:busy,required,placeholder,maxLength:key==='name'?40:2000,rows:multiline?3:undefined,onChange:e=>change(key,e.target.value)})),
    useForChat&&key!=='name'&&check('用于下次提问',selectedFields.has(key),()=>toggle(setSelectedFields,key),!bcHealth.hasValue(draft[key])));
  const chips=(key,values)=>bcH('div',{className:'bc-clinic-choice-group'},bcH('div',{className:'bc-clinic-chips'},...values.map(v=>bcH('button',{key:v,type:'button',disabled:busy,'aria-pressed':draft[key].includes(v),onClick:()=>change(key,draft[key].includes(v)?draft[key].filter(x=>x!==v):[...draft[key],v])},v))),useForChat&&check('用于下次提问',selectedFields.has(key),()=>toggle(setSelectedFields,key),!draft[key].length));
  const resourceUpdate=(index,key,value)=>change('resources',draft.resources.map((r,i)=>i===index?{...r,[key]:value}:r));
  const reportField=(r,key,label,options)=>bcH('label',{className:'bc-clinic-field',key},bcH('span',null,label),options?bcH('select',{'data-report-field':key,value:r[key],disabled:busy,onChange:e=>changeReport(r.id,key,e.target.value)},...options.map(v=>bcH('option',{key:v,value:v},v))):bcH('input',{'data-report-field':key,value:r[key],disabled:busy,maxLength:key==='title'?180:300,onChange:e=>changeReport(r.id,key,e.target.value)}));
  const referenceCount=reports.filter(r=>selectedReports.has(r.id)&&r.status==='可供 Agent 引用').length;
  return bcH('dialog',{ref:dialog,className:'bc-health-drawer','aria-labelledby':'bc-health-title',onCancel:e=>{e.preventDefault();close();},onClick:e=>{if(e.target===dialog.current&&e.clientX<dialog.current.getBoundingClientRect().left)close();}},
    bcH('header',{className:'bc-health-header'},bcH(BcHealthIcon,{size:29}),bcH('div',null,bcH('h2',{id:'bc-health-title',tabIndex:-1,ref:titleRef},'我的诊室档案'),bcH('p',null,'熟悉诊室背景，让协作更贴合日常工作')),bcH('button',{type:'button',className:'bc-health-close','aria-label':'关闭诊室档案',disabled:busy,onClick:close},'×')),
    bcH('div',{className:'bc-health-body'},error&&bcH('div',{className:'bc-health-error',role:'alert'},error),notice&&bcH('div',{className:'bc-health-notice',role:'status'},bcH(BcHealthIcon,{name:'check',size:16}),notice),
      !draft?bcH('p',null,busy?'正在读取档案…':'档案未能打开，请关闭后重试。'):bcH(react.Fragment,null,
        bcH('div',{className:'bc-health-owner'},bcH(BcHealthIcon,{name:'folder'}),bcH('span',null,'当前诊室'),bcH('select',{'aria-label':'当前诊室',value:draft.id,disabled:busy,onChange:e=>switchMember(e.target.value)},...(!members.some(m=>m.id===draft.id)?[bcH('option',{value:draft.id,key:draft.id},draft.name||'新诊室')]:[]),...members.map(m=>bcH('option',{key:m.id,value:m.id},m.id===draft.id?(draft.name||'新诊室'):(m.name||'未设置诊室')))),textButton('+ 添加诊室',addMember)),
        bcH('nav',{className:'bc-health-tabs',role:'tablist','aria-label':'诊室档案栏目'},...Object.entries({overview:'诊室概况',work:'诊疗工作',reports:'资料与模板'}).map(([key,label])=>bcH('button',{type:'button',role:'tab',id:'bc-clinic-tab-'+key,'aria-controls':'bc-clinic-panel',key,'aria-selected':tab===key,'aria-pressed':tab===key,onClick:()=>setTab(key)},label))),
        bcH('div',{role:'tabpanel',id:'bc-clinic-panel','aria-labelledby':'bc-clinic-tab-'+tab},
          tab==='overview'?bcH(react.Fragment,null,
            sectionTitle('诊室概况','名称与专科必填；默认专科用于新会话，其余信息可随时补充。'),
            bcH('div',{className:'bc-clinic-grid'},field('name',{label:'诊室名称',placeholder:'例如：妇科门诊一诊室',required:true}),field('specialty',{options:['妇科','儿科'],required:true}),field('institution',{placeholder:'选填，例如：某某妇幼保健院'}),field('department',{placeholder:'选填，例如：妇科门诊'}),field('role',{options:['门诊医生','住院医生','科室管理','护理人员','其他'],wide:true})),
            bcH('section',null,sectionTitle('服务人群与重点方向','可多选；未填写不会限制专科模式的服务范围。'),chips('directions',['妇科常见问题','青春期保健','备孕与生殖健康','孕产期保健','更年期管理','儿童常见问题','生长发育','儿童营养','心理行为','青少年保健']),field('directionNote',{label:'补充说明',multiline:true,placeholder:'补充诊室的重点服务对象、年龄范围或特色方向'})),
            bcH('p',{className:'bc-clinic-note'},'这里记录诊室背景。患者主诉、病史及检查结果请放在对应病例会话中。'),
            draft.revision>0&&bcH('div',{className:'bc-health-remove-member'},textButton('移除此诊室',removeMember))):
          tab==='work'?bcH(react.Fragment,null,
            bcH('section',null,sectionTitle('常用工作任务','选择日常最常处理的任务。'),chips('tasks',['病例梳理','鉴别思路','检查结果解读','病历整理','患者宣教','随访文案','交班摘要','科室办公'])),
            bcH('section',null,sectionTitle('诊室可用资源','用于考虑本地条件；未填写代表未知。'),...draft.resources.map((r,i)=>bcH('div',{className:'bc-clinic-resource',key:i},bcH('input',{'aria-label':`资源名称 ${i+1}`,value:r.name,placeholder:'检查、服务或设备名称',maxLength:80,disabled:busy,onChange:e=>resourceUpdate(i,'name',e.target.value)}),bcH('select',{'aria-label':`资源状态 ${i+1}`,value:r.status,disabled:busy,onChange:e=>resourceUpdate(i,'status',e.target.value)},...['可开展','需转诊','待确认'].map(v=>bcH('option',{value:v,key:v},v))),textButton('移除',()=>change('resources',draft.resources.filter((_,j)=>j!==i))))),textButton('+ 添加资源',()=>change('resources',[...draft.resources,{name:'',status:'待确认'}]),{disabled:busy||draft.resources.length>=20}),useForChat&&check('用于下次提问',selectedFields.has('resources'),()=>toggle(setSelectedFields,'resources'),!draft.resources.length)),
            field('workflow',{wide:true,multiline:true,placeholder:'记录常用就诊、检查、会诊与转诊流程；也可在资料页上传院内流程'}),
            sectionTitle('沟通与输出偏好'),bcH('div',{className:'bc-clinic-grid'},field('communication',{options:['专业版','患者易懂版','同时提供两版']}),field('verbosity',{options:['简洁','适中','详细']}),field('outputFormat',{wide:true,multiline:true,placeholder:'例如：先给结论，再列依据与待补充信息'}),field('citations',{wide:true,options:['关键结论标注依据','优先引用已选诊室资料，注明版本','需要引用时注明来源与不确定性']})),bcH('p',{className:'bc-clinic-note'},'表达偏好不会省略必要的风险提示，也不会补写未提供的病史、检查或文献。')):
          bcH(react.Fragment,null,
            bcH('div',{className:'bc-health-upload'},bcH(BcHealthIcon,{name:'report',size:26}),bcH('div',null,bcH('strong',null,'添加诊室资料与模板'),bcH('small',null,'PDF、图片 · 单份不超过 10 MB')),bcH('button',{type:'button',disabled:busy||!draft.revision,onClick:()=>fileInput.current.click()},'上传资料')),
            bcH('p',{className:'bc-health-hint'},draft.revision?'上传后填写资料要点。当前仅引用经你确认的文字，原文件不会自动解析。':'先保存诊室名称和专科，即可上传资料。'),
            reports.length===0&&bcH('div',{className:'bc-health-empty'},bcH(BcHealthIcon,{name:'report',size:32}),bcH('strong',null,'让常用资料随手可用'),bcH('p',null,'指南与共识 · 院内流程 · 文书模板 · 宣教材料 · 办公模板')),
            ...reports.map(r=>bcH('article',{className:'bc-health-report',key:r.id},bcH('div',{className:'bc-health-report-title'},bcH(BcHealthIcon,{name:'report'}),bcH('strong',null,r.title),bcH('span',{className:'bc-clinic-status','data-ready':r.status==='可供 Agent 引用'},r.status)),bcH('div',{className:'bc-health-report-actions'},textButton('预览',()=>previewReport(r)),textButton('移除',()=>removeReport(r))),
              bcH('div',{className:'bc-clinic-grid'},reportField(r,'title','资料标题'),reportField(r,'category','资料类型',bcHealth.categories),reportField(r,'scope','适用范围',bcHealth.scopes),reportField(r,'status','处理状态',bcHealth.statuses),reportField(r,'source','来源 / 发布机构'),reportField(r,'version','版本或日期')),
              bcH('label',{className:'bc-clinic-field'},bcH('span',null,'确认的资料要点 / 模板内容'),bcH('textarea',{'data-report-field':'summary',value:r.summary,rows:4,maxLength:3000,disabled:busy,placeholder:'填写可供参考的内容；模板请写明所需格式与字段。启用引用前请核对来源和版本。',onChange:e=>changeReport(r.id,'summary',e.target.value)})),
              useForChat&&check('下次提问选用此资料',selectedReports.has(r.id),()=>toggle(setSelectedReports,r.id),r.status!=='可供 Agent 引用'),bcH('small',{className:'bc-clinic-file-meta'},`${r.name} · ${(r.size/1024/1024).toFixed(1)} MB`))))),
        bcH('p',{className:'bc-health-storage'},'诊室档案与文件保存在当前浏览器。清除网站数据会移除这些资料。'))),
    bcH('footer',{className:'bc-health-footer'},check('下次提问使用此诊室档案',useForChat,()=>{setUseForChat(!useForChat);edited();},!sessionId||!draft),
      bcH('p',null,!sessionId?'先选择工作区，即可选用诊室档案。':useForChat&&draft?`已选 ${[...selectedFields].filter(k=>bcHealth.hasValue(draft[k])).length} 项信息、${referenceCount} 份资料；按提问时的专科模式筛选。`:'保存档案不会自动发送；选用后仅随下一条消息发送。'),
      useForChat&&draft&&bcH('details',{className:'bc-clinic-context-preview'},bcH('summary',null,'查看下次提问选用内容'),bcH('p',null,'诊室：'+draft.name),bcH('p',null,'信息：'+[...selectedFields].filter(k=>bcHealth.hasValue(draft[k])).map(k=>bcHealth.fields[k]).join('、')),bcH('p',null,'资料：'+(reports.filter(r=>selectedReports.has(r.id)&&r.status==='可供 Agent 引用').map(r=>`${r.title}（${r.scope}）`).join('、')||'未选用')),bcH('p',null,'提问时按会话的实际模式筛选资料。已发送内容会留在该会话中。')),
      bcH('div',null,bcH('button',{type:'button',disabled:busy,onClick:close},'关闭'),bcH('button',{type:'button',className:'bc-health-primary',disabled:busy||!draft,onClick:save},busy?'处理中…':'保存档案'))),
    bcH('input',{type:'file',ref:fileInput,hidden:true,multiple:true,accept:'.pdf,.png,.jpg,.jpeg,.webp',onChange:e=>upload([...e.target.files])}),
    preview&&bcH('div',{className:'bc-health-preview'},bcH('header',null,bcH('strong',null,preview.name),textButton('返回档案',()=>setPreview(null))),preview.type==='application/pdf'?bcH('iframe',{src:preview.url,title:preview.name,sandbox:''}):bcH('img',{src:preview.url,alt:preview.name}),bcH('a',{href:preview.url,download:preview.name},'下载原文件')));
}
