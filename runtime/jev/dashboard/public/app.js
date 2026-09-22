import {FIELDS,TITLES,LABELS,QUEUES,MODES,signals,answersOf,itemStatus,metrics,itemDuration,itemProviderDuration} from '/shared.mjs';

const $=id=>document.getElementById(id);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const pct=p=>`${Math.round(p*100)}%`;
const duration=ms=>ms===null||!Number.isFinite(ms)?'—':ms<60000?`${(ms/1000).toFixed(1)}s`:`${Math.floor(ms/60000)}m ${Math.floor(ms%60000/1000)}s`;
const money=n=>n===null?'—':`$${n.toFixed(5)}`;
const statusNames={queued:'待评估',running:'评估中',partial:'已完成 3/6',completed:'已完成',failed:'调用失败'};
const runNames={running:'运行中',pausing:'暂停中',paused:'已暂停',completed:'已完成',completed_with_errors:'存在失败项',interrupted:'已中断',cancelled:'已结束',cancelling:'结束中'};
const fieldNotes={service_scope:'判断本轮诉求与已定义服务范围的关系。',capability_coverage:'判断所需能力是否已配置；不代表本次回答成功。',explicit_dissatisfaction:'表示明确不满的概率，没有额外的“置信度”字段。身体不适或提出新约束不自动等于不满。',response_coverage:'检查是否回应主要诉求，包括必要澄清和合理解释限制。',context_consistency:'核对人物、时间、事实纠正及用户约束；不判断医学事实。',execution_claim:'检查实际动作的完成声称与执行证据是否匹配。'};
let data, rows, runs=new Map(), mode='history',liveId=null,selectedId=null,follow=true,replayCount=0,playing=false,replayTimer=null,csrf;
let selectedRendered=null,lastJudgeSignature='',lastReviewSignature='',noticeTimer,requestBusy=false;
const cards=new Map(),judgmentNodes=new Map();

function blankItems(){return data.rows.map(row=>({rowId:row.id,modes:{query:{status:'queued'},qa:{status:'queued'}}}));}
function currentRun(){return mode==='history'?data.history:runs.get(liveId);}
function items(){return mode==='history'?data.history.items.slice(0,replayCount):currentRun()?.items??blankItems();}
function selectedItem(){return items().find(item=>item.rowId===selectedId);}
function showNotice(message,temporary=false){clearTimeout(noticeTimer);$('notice').hidden=!message;$('notice').textContent=message??'';if(temporary)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},6500);}
function queuedSignals(item){const found=signals(answersOf(item)).queues;if(itemStatus(item)==='failed')found.push('failed');if(mode==='history'&&rows.get(item.rowId)?.spotcheck_note)found.push('spotcheck_note');return found;}
function filteredItems(){const search=$('search').value.trim().toLowerCase(),filter=$('filter').value,group=$('group').value;return items().filter(item=>{const row=rows.get(item.rowId);return (!search||`${row.id} ${row.query} ${row.answer} ${row.title}`.toLowerCase().includes(search))&&(filter==='all'||queuedSignals(item).includes(filter))&&(group==='all'||row.sampling_group===group);});}

function newestId(all){
  const active=all.find(item=>itemStatus(item)==='running');if(active)return active.rowId;
  return [...all].filter(item=>Object.keys(answersOf(item)).length).sort((a,b)=>{
    const end=item=>Math.max(...MODES.map(m=>Date.parse(item.modes[m]?.result?.evaluatedAt??'')||0));return end(b)-end(a);
  })[0]?.rowId??all[0]?.rowId??null;
}
function selectRow(id,pin=true){selectedId=id;if(pin)follow=false;renderSelection();renderList();renderDistributions();updateMetrics();}
function renderSelection(){
  $('follow').setAttribute('aria-pressed',String(follow));$('follow').textContent=follow?'● 跟随最新':'○ 恢复跟随';
  const row=rows.get(selectedId),item=selectedItem();
  if(!row||!item){$('qa-detail').replaceChildren(element('p',playing?'正在回放，首条 QA 即将进入…':'选择一条 QA 查看完整对话','empty'));$('detail-heading').textContent='当前 QA';$('selected-title').textContent='等待选择 QA';selectedRendered=null;renderJudgments();return;}
  $('detail-heading').textContent=row.id;
  $('selected-title').replaceChildren(element('span',row.title),element('small',row.id));
  if(selectedRendered!==`${mode}:${selectedId}`){
    const detail=$('qa-detail');detail.replaceChildren(element('h3',row.title),element('p',`${row.sampling_group} · ${row.scenario_id}`,'detail-meta'),element('div','用户诉求','speaker'),element('div',row.query,'text-block question-text'),element('div','助手回答','speaker answer'),element('div',row.answer,'text-block'));
    if(row.previous_turns.length){const previous=element('details');previous.append(element('summary',`查看前 ${row.previous_turns.length} 轮上下文`));for(const turn of row.previous_turns)previous.append(element('div',`用户：${turn.query}\n\n助手：${turn.answer}`,'history-copy'));detail.append(previous);}
    if(mode==='history'&&row.spotcheck_note){const note=element('details');note.append(element('summary','查看 Codex 历史抽查笔记'),element('div',row.spotcheck_note+'（非 Jev 输出，非医学审核）','note-review'));detail.append(note);}
    detail.scrollTop=0;selectedRendered=`${mode}:${selectedId}`;
  }
  renderJudgments();
}

function initializeJudgments(){
  for(const field of FIELDS){
    const details=element('details',undefined,'judgment waiting');
    const summary=element('summary'),dimension=element('span',TITLES[field],'dimension');
    const center=element('div'),line=element('div',undefined,'label-value'),label=element('span','等待评估'),flag=element('small');line.append(label,flag);
    const track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');track.append(fill);center.append(line,track);
    const probability=element('span','—','probability');summary.append(dimension,center,probability);
    const options=element('div',undefined,'probability-options'),note=element('p',fieldNotes[field],'judge-note');details.append(summary,options,note);$('judgments').append(details);
    judgmentNodes.set(field,{details,label,flag,fill,probability,options});
  }
}
function renderJudgments(){
  const item=selectedItem(),answers=answersOf(item),uncertain=signals(answers).uncertain;
  const signature=JSON.stringify([selectedId,mode,item?.modes]);if(signature===lastJudgeSignature)return;lastJudgeSignature=signature;
  $('judgment-meta').textContent=`${Object.keys(answers).length} / 6 判断`;
  for(const field of FIELDS){
    const node=judgmentNodes.get(field),answer=answers[field],job=item?.modes[FIELDS.indexOf(field)<3?'query':'qa'];
    node.details.classList.toggle('uncertain',uncertain.includes(field));node.details.classList.toggle('waiting',!answer);node.details.classList.toggle('running',['running','retrying'].includes(job?.status));
    if(!answer){node.label.textContent=job?.status==='failed'?'调用失败':job?.status==='retrying'?'等待重试':job?.status==='running'?'正在判断…':'等待评估';node.flag.textContent='';node.probability.textContent='—';node.fill.style.width='0%';node.options.replaceChildren(element('p',job?.error??'该维度尚未返回结果。','muted'));continue;}
    const p=answer.type==='choice'?answer.probabilities[answer.choice]:answer.probability;
    node.label.textContent=answer.type==='choice'?(LABELS[answer.choice]??answer.choice):'明确不满的概率';node.flag.textContent=uncertain.includes(field)?'需复核':'';node.probability.textContent=pct(p);node.fill.style.width=pct(p);
    node.options.replaceChildren();
    const distribution=answer.type==='choice'?Object.entries(answer.probabilities).sort((a,b)=>b[1]-a[1]):[['是',answer.probability],['否',1-answer.probability]];
    for(const [key,value] of distribution){const option=element('div',undefined,'probability-option'),track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');fill.style.width=pct(value);track.append(fill);option.append(element('span',LABELS[key]??key),track,element('span',pct(value)));node.options.append(option);}
  }
}

function renderList(){
  const focused=document.activeElement;
  const list=filteredItems(),fragment=document.createDocumentFragment();
  $('qa-counter').textContent=`${list.length} / ${mode==='history'?data.rows.length:items().length} QA`;
  for(const item of list){
    const row=rows.get(item.rowId),status=itemStatus(item),answers=answersOf(item),uncertain=signals(answers).uncertain;
    let node=cards.get(row.id);
    if(!node){node=element('button',undefined,'qa-card');node.type='button';node.addEventListener('click',()=>selectRow(row.id));cards.set(row.id,node);}
    const signature=JSON.stringify([status,answers,mode]);
    if(node.dataset.signature!==signature){
      node.dataset.signature=signature;
      const top=element('div',undefined,'qa-card-top');top.append(element('span',row.id,'mono'),element('span',statusNames[status],'status '+status));
      const strips=element('div',undefined,'signals');strips.setAttribute('aria-hidden','true');for(const field of FIELDS)strips.append(element('i',undefined,!answers[field]?'pending':uncertain.includes(field)?'warn':''));
      node.replaceChildren(top,element('p',row.query),element('p',row.answer.replace(/[#*`]/g,''),'qa-preview'),strips);
    }
    node.classList.toggle('selected',row.id===selectedId);node.setAttribute('aria-pressed',String(row.id===selectedId));node.setAttribute('aria-label',`${row.id}，${row.title}，${statusNames[status]}`);fragment.append(node);
  }
  $('qa-list').replaceChildren(fragment);
  if(focused?.classList.contains('qa-card')&&focused.parentElement===$('qa-list'))focused.focus({preventScroll:true});
  if(!list.length)$('qa-list').append(element('p',items().length?'没有匹配的 QA，试试其他筛选条件。':'等待第一条 QA 进入评估看板。','empty'));
  if(follow){const current=cards.get(selectedId);if(current?.parentElement){const box=$('qa-list'),top=current.offsetTop-box.offsetTop;if(top<box.scrollTop||top+current.offsetHeight>box.scrollTop+box.clientHeight)box.scrollTo({top:Math.max(0,top-30),behavior:'auto'});}}
}

function updateMetrics(){
  const all=items(),run=currentRun(),stats=metrics(all),total=mode==='history'?data.rows.length:all.length,item=selectedItem();
  $('metric-done').textContent=stats.completed;$('metric-total').textContent=`/ ${total}`;$('metric-progress').textContent=total?`${Math.round(stats.completed/total*100)}% 完成`:'尚未开始';$('progress').style.width=total?`${stats.completed/total*100}%`:'0%';
  $('metric-status').textContent=mode==='history'?(playing?'回放中':replayCount===total?'已加载':'回放暂停'):(runNames[run?.status]??'待创建');
  $('metric-judgments').textContent=stats.judgments.toLocaleString();$('metric-requests').textContent=`${stats.requests} 次成功请求 · ${stats.failed} 条调用失败`;
  $('metric-cost').textContent=money(stats.cost);$('metric-cost-note').textContent=stats.costKnown?`网关报告 · ${stats.costKnown}/${stats.requests} 次有费用`:'费用尚未返回';$('metric-cost').title=stats.marketCost!==null?`marketCost 原始字段合计 $${stats.marketCost.toFixed(8)}；不等同于实际账单。`:'';
  const latency=itemProviderDuration(item),recorded=itemDuration(item);
  $('metric-latency').textContent=latency===null?'—':latency<1000?Math.round(latency):(latency/1000).toFixed(2);$('latency-unit').textContent=latency===null?'':latency<1000?'ms':'s';
  $('metric-latency').title='所选 QA 的两次成功上游调用合计；不等于本地端到端耗时或纯模型推理耗时。';
  const active=MODES.map(m=>[m,item?.modes[m]]).find(([,job])=>job?.status==='running');
  $('metric-latency-note').textContent=active?`请求进行中 · ${duration(Date.now()-Date.parse(active[1].startedAt))}`:recorded!==null?`${mode==='history'?'整轮记录':'请求合计'} ${duration(recorded)}${mode==='history'?'（含等待）':''}`:'等待耗时记录';
  const pending=mode==='history'?data.rows.length-data.history.items.filter(i=>itemStatus(i)==='completed').length:total-stats.completed;
  $('subtitle').textContent=`待评估 ${pending} 条`;
  let elapsed=null;
  if(run?.startedAt){const end=mode==='history'?(all.length?Math.max(...all.flatMap(i=>MODES.map(m=>Date.parse(i.modes[m].result.evaluatedAt)))):Date.parse(run.startedAt)):run.endedAt?Date.parse(run.endedAt):Date.now();elapsed=Math.max(0,end-Date.parse(run.startedAt));}
  $('metric-elapsed').textContent=duration(elapsed);$('elapsed-label').textContent=mode==='history'?'历史批次耗时':'当前总耗时';$('metric-elapsed-note').textContent=mode==='history'?'真实记录，含限流与补跑间隔':'批次历时，含排队与暂停时间';$('metric-review').textContent=stats.uncertain;
}

function renderDistributions(){
  const all=items(),completed=all.filter(i=>itemStatus(i)==='completed'),stats=metrics(all);$('distribution-count').textContent=`${completed.length} QA`;
  const columns=[{title:'服务范围',field:'service_scope'},{title:'能力覆盖',field:'capability_coverage'},{title:'产品信号',counts:{'能力缺口候选':stats.gaps,'badcase 候选':stats.badcases,'判断摇摆':stats.uncertain}}];
  $('distribution').replaceChildren();
  for(const column of columns){const node=element('div',undefined,'distribution-column');node.append(element('h3',column.title));const counts=column.counts??{};
    if(column.field)for(const item of all){const choice=answersOf(item)[column.field]?.choice;if(choice)counts[LABELS[choice]??choice]=(counts[LABELS[choice]??choice]??0)+1;}
    const values=Object.entries(counts).sort((a,b)=>b[1]-a[1]);const base=Math.max(1,...values.map(([,n])=>n));
    if(!values.length)node.append(element('div','等待结果','mono'));
    for(const [label,count] of values.slice(0,5)){const row=element('div',undefined,'distribution-row'),line=element('div',undefined,'line'),track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');line.append(element('span',label),element('span',count));fill.style.width=`${count/base*100}%`;track.append(fill);row.append(line,track);node.append(row);}
    $('distribution').append(node);
  }
  const review=all.filter(item=>queuedSignals(item).length);$('review-count').textContent=`${review.length} 条 · 队列可重叠`;
  const signature=JSON.stringify([mode,selectedId,review.map(i=>[i.rowId,queuedSignals(i)])]);if(signature===lastReviewSignature)return;lastReviewSignature=signature;
  $('review-list').replaceChildren();
  for(const item of review){const found=queuedSignals(item),card=element('button',undefined,'review-card'+(item.rowId===selectedId?' selected':''));card.append(element('strong',item.rowId),element('small',found.map(q=>QUEUES[q]).join(' · ')));card.addEventListener('click',()=>{selectRow(item.rowId);renderDistributions();});$('review-list').append(card);}
  if(!review.length)$('review-list').append(element('p','暂未触发复核规则。零候选不等于全部回答通过。','empty'));
}

function renderControls(){
  $('history-mode').setAttribute('aria-pressed',String(mode==='history'));$('live-mode').setAttribute('aria-pressed',String(mode==='live'));$('replay-controls').hidden=mode!=='history';$('live-controls').hidden=mode!=='live';
  $('run-select').replaceChildren();
  if(mode==='history'){const option=element('option',data.history.name+' · '+data.history.questionVersion);option.value=data.history.id;$('run-select').append(option);}
  else if(!runs.size){$('run-select').append(element('option','尚无实时批次'));}
  else for(const run of [...runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))){const option=element('option',`${run.name} · ${runNames[run.status]}`);option.value=run.id;$('run-select').append(option);}
  if(mode==='live'&&liveId)$('run-select').value=liveId;
  const run=currentRun(),busy=['running','pausing','cancelling'].includes(run?.status),hasActive=[...runs.values()].some(r=>['running','pausing','cancelling'].includes(r.status));
  $('run-note').textContent=mode==='history'?(playing?'历史结果逐条回放 · 不调用模型':'已保存的真实结果 · 可查看全部或逐条回放'):(run?.message??'选择 QA 创建批次，实时获取 Jev 结果');
  $('pause-run').hidden=run?.status!=='running';$('resume-run').hidden=!['paused','interrupted','cancelled'].includes(run?.status);
  $('retry-run').hidden=!run||busy||!run.items.some(item=>MODES.some(m=>item.modes[m].status==='failed'));
  $('cancel-run').hidden=!run||['completed','cancelled','completed_with_errors'].includes(run.status);
  $('new-run').disabled=hasActive||!data.apiConfigured||!data.liveEligibleIds.length;
  $('new-run').title=!data.apiConfigured?'未配置服务端网关凭据':!data.liveEligibleIds.length?'缺少已裁剪的评估输入':hasActive?'已有批次正在运行':'';
  $('replay-play').textContent=playing?'Ⅱ 暂停回放':replayCount>0&&replayCount<data.rows.length?'▶ 继续回放':'▶ 开始回放';
}
function render(){const all=items();if(follow)selectedId=newestId(all);else if(!all.some(i=>i.rowId===selectedId))selectedId=all[0]?.rowId??null;renderControls();renderList();renderSelection();renderDistributions();updateMetrics();}
function stopReplay(){playing=false;clearInterval(replayTimer);replayTimer=null;}
function startReplay(){
  if(replayCount>=data.rows.length)replayCount=0;playing=true;follow=true;render();
  clearInterval(replayTimer);replayTimer=setInterval(()=>{replayCount=Math.min(data.rows.length,replayCount+1);if(replayCount>=data.rows.length)stopReplay();render();},1000/Number($('speed').value));
}
function setMode(next){stopReplay();mode=next;selectedRendered=null;lastJudgeSignature='';render();}
async function post(url,body={}){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':csrf},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error??'操作失败');return value;}
async function action(name){if(requestBusy)return;requestBusy=true;try{const run=await post(`/api/runs/${liveId}/${name}`);runs.set(run.id,run);render();}catch(error){showNotice(error.message,true);}finally{requestBusy=false;}}
function scopeIds(){const scope=$('run-scope').value;const ids=scope==='selected'?[selectedId]:scope==='ten'?data.rows.slice(0,10).map(r=>r.id):scope==='filtered'?filteredItems().map(i=>i.rowId):data.rows.map(r=>r.id);return ids.filter(id=>data.liveEligibleIds.includes(id));}
function showEstimate(){const count=scopeIds().length;$('run-estimate').textContent=`${count} 条 QA / ${count*2} 次请求 / ${count*6} 个判断`;$('confirm-run').disabled=count===0;}
function openInfo(title,content){$('info-title').textContent=title;$('info-body').replaceChildren(...content);$('info-dialog').showModal();}

async function boot(){
  const response=await fetch('/api/bootstrap');if(!response.ok)throw new Error('无法加载本地评估数据。');data=await response.json();csrf=data.csrf;rows=new Map(data.rows.map(r=>[r.id,r]));runs=new Map(data.runs.map(r=>[r.id,r]));liveId=data.runs[0]?.id??null;replayCount=data.rows.length;
  for(const [value,text] of Object.entries(QUEUES)){const option=element('option',text);option.value=value;$('filter').append(option);}
  for(const name of ['all',...new Set(data.rows.map(r=>r.sampling_group))]){const option=element('option',name==='all'?'全部主题':name);option.value=name;$('group').append(option);}
  initializeJudgments();render();
  $('history-mode').onclick=()=>setMode('history');$('live-mode').onclick=()=>setMode('live');
  $('run-select').onchange=()=>{if(mode==='live'){liveId=$('run-select').value;follow=true;render();}};
  $('replay-play').onclick=()=>{if(playing){stopReplay();renderControls();updateMetrics();}else startReplay();};
  $('show-all').onclick=()=>{stopReplay();replayCount=data.rows.length;render();};$('speed').onchange=()=>{if(playing)startReplay();};
  for(const id of ['search','filter','group'])$(id).addEventListener('input',renderList);
  $('follow').onclick=()=>{follow=true;render();};$('review-metric').onclick=()=>{$('filter').value='uncertain';renderList();};
  $('pause-run').onclick=()=>action('pause');$('resume-run').onclick=()=>action('resume');$('retry-run').onclick=()=>action('retry');$('cancel-run').onclick=()=>action('cancel');
  $('new-run').onclick=()=>{$('run-error').textContent='';showEstimate();$('run-dialog').showModal();};$('run-scope').onchange=showEstimate;
  $('run-form').onsubmit=async event=>{event.preventDefault();$('confirm-run').disabled=true;try{const run=await post('/api/runs',{ids:scopeIds()});runs.set(run.id,run);liveId=run.id;mode='live';follow=true;$('run-dialog').close();$('filter').value='all';$('search').value='';$('group').value='all';render();}catch(error){$('run-error').textContent=error.message;}finally{showEstimate();}};
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
  $('about').onclick=()=>openInfo('如何阅读这个看板',[
    element('h3','结果回放与实时评估'),element('p','结果回放按展示速度逐条呈现已完成的真实判断，不调用模型。顶部成本、单条耗时和历史批次耗时来自原始评估记录，不是播放动画的计时。实时评估会创建独立批次，按每 2.5 秒最多启动一次请求调度；暂停会等待当前请求返回。'),
    element('h3','六个判断，相互独立'),element('p','诉求评估读取用户问题、必要历史和产品能力快照；回答评估再加入本轮回答与执行证据。页面不生成医学质量总分，也不把概率解释成准确率。'),
    element('h3','候选队列的含义'),element('p','选择题最高概率 < 0.60，或前两项差值 < 0.20；布尔题概率在 0.35–0.65 时，进入判断摇摆队列。能力缺口不等于新需求，badcase 候选也需要复核；这些阈值尚未校准，队列可重叠。'),
    element('h3','费用与耗时'),element('p','累计成本汇总网关 cost 字段；缺失显示“未返回”，0 表示网关确实返回零。marketCost 原始值可在记录里查看，不等于实际账单。顶部 Jev 上游耗时为网关记录的两次成功上游调用合计，不是纯模型推理时间或端到端耗时。下方另列整轮记录：历史记录包含调度等待，实时请求合计不包含排队；总耗时包含限流、暂停及重试间隔。失败请求未返回的费用无法统计。'),
    element('h3','本批样本'),element('p','问题为新编的合成情境，回答由本地 DSH 实际生成。历史抽查笔记由 Codex 编写，单独标明，不属于 Jev 输出，不代表医学审核或人工金标准。'),
  ]);
  $('evidence-button').onclick=()=>{const item=selectedItem(),row=rows.get(selectedId);if(!item||!row)return;openInfo('当前 QA · 输入与请求记录',[
    element('p',`${row.id} · Session ${row.session_id}`),element('h3','模型输入范围'),element('p','裁剪后的产品范围、能力快照、当前问答及必要历史。未发送内部推理、作者预期标签或认证信息。'),
    element('h3','原始记录'),element('pre',JSON.stringify({mode,questionVersion:currentRun()?.questionVersion??data.questionVersion,durationBasis:currentRun()?.durationBasis,modes:item.modes},null,2)),
    element('h3','本批产品能力快照'),element('pre',JSON.stringify(data.contract.product_contract,null,2)),
  ]);};
  $('download').onclick=()=>{const exported={runId:currentRun()?.id??null,mode,exportedAt:new Date().toISOString(),rows:items().map(item=>({...rows.get(item.rowId),evaluation:item,signals:signals(answersOf(item)),spotcheck_note:mode==='history'?rows.get(item.rowId).spotcheck_note:null}))};const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'})),link=element('a');link.href=url;link.download=`jev-${currentRun()?.id??'unscored'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const events=new EventSource('/api/events');
  events.onopen=()=>{$('connection').textContent='本地服务已连接';$('connection').classList.remove('offline');};
  events.onerror=()=>{$('connection').textContent='连接中断 · 正在重连';$('connection').classList.add('offline');};
  events.addEventListener('snapshot',event=>{const all=JSON.parse(event.data);runs=new Map(all.map(run=>[run.id,run]));if(!liveId)liveId=all[0]?.id??null;if(mode==='live')render();});
  events.addEventListener('run',event=>{const run=JSON.parse(event.data);runs.set(run.id,run);if(mode==='live'&&run.id===liveId)render();});
  setInterval(()=>{if(mode==='live')updateMetrics();},1000);
}
boot().catch(error=>{showNotice(error.message);$('connection').textContent='加载失败';$('connection').classList.add('offline');$('subtitle').textContent='请确认本地看板服务已启动，然后刷新页面。';});
