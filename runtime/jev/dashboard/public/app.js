import {FIELDS as LEGACY_FIELDS,V2_FIELDS,V3_FIELDS,TITLES,LABELS,QUEUES,MODES,signals,answersOf,itemStatus,metrics,itemProviderDuration,matchesDistribution} from '/shared.mjs';
import {createMarkdownRenderer} from '/markdown.mjs';

const $=id=>document.getElementById(id);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const renderMarkdown=createMarkdownRenderer(window.markdownit);
const markdown=(text,className='text-block')=>{const node=element('div',undefined,`${className} markdown-body`);node.innerHTML=renderMarkdown(text);return node;};
const pct=p=>`${Math.round(p*100)}%`;
const duration=ms=>ms===null||!Number.isFinite(ms)?'—':ms<60000?`${(ms/1000).toFixed(1)}s`:`${Math.floor(ms/60000)}m ${Math.floor(ms%60000/1000)}s`;
const money=n=>n===null?'—':`$${n.toFixed(5)}`;
const statusNames={queued:'待评估',running:'评估中',partial:'部分已评估',completed:'已完成',failed:'调用失败'};
const runNames={running:'运行中',pausing:'暂停中',paused:'已暂停',completed:'已完成',completed_with_errors:'存在失败项',interrupted:'已中断',cancelled:'已结束',cancelling:'结束中'};
const isIssue=answer=>answer?.applicable!==false&&['unsupported_fact','excessive_followup','evidence_conflict','suspected_error','risk_detected','violated','poor_actionability','poor_communication','overloaded','partial','off_target'].includes(answer?.choice);
const fieldNotes={service_scope:'判断本轮诉求与已定义服务范围的关系。',capability_coverage:'判断所需能力是否已配置；不代表本次回答成功。',explicit_dissatisfaction:'表示明确不满的概率，没有额外的“置信度”字段。身体不适或提出新约束不自动等于不满。',response_coverage:'检查是否回应主要诉求，包括必要澄清和合理解释限制。',context_consistency:'核对人物、时间、事实纠正及用户约束；不判断医学事实。',execution_claim:'检查实际动作的完成声称与执行证据是否匹配。'};
let FIELDS=LEGACY_FIELDS;
let data, rows, runs=new Map(), mode='history',liveId=null,selectedId=null,follow=true,replayCount=0,playing=false,replayTimer=null,csrf;
let selectedRendered=null,lastJudgeSignature='',lastReviewSignature='',noticeTimer,requestBusy=false;
let distributionFilter=null;
const cards=new Map(),judgmentNodes=new Map();

function blankItems(){return data.rows.map(row=>({rowId:row.id,modes:{query:{status:'queued'},qa:{status:'queued'}}}));}
function currentRun(){return mode==='history'?data.history:runs.get(liveId);}
function items(){return mode==='history'?data.history.items.slice(0,replayCount):currentRun()?.items??blankItems();}
function selectedItem(){return items().find(item=>item.rowId===selectedId);}
function showNotice(message,temporary=false){clearTimeout(noticeTimer);$('notice').hidden=!message;$('notice').textContent=message??'';if(temporary)noticeTimer=setTimeout(()=>{$('notice').hidden=true;},6500);}
function queuedSignals(item){const found=signals(answersOf(item)).queues;if(itemStatus(item)==='failed')found.push('failed');if(mode==='history'&&rows.get(item.rowId)?.spotcheck_note)found.push('spotcheck_note');return found;}
function filteredItems(){const search=$('search').value.trim().toLowerCase(),filter=$('filter').value,group=$('group').value;return items().filter(item=>{const row=rows.get(item.rowId);return matchesDistribution(item,distributionFilter)&&(!search||`${row.id} ${row.query} ${row.answer} ${row.title}`.toLowerCase().includes(search))&&(filter==='all'||queuedSignals(item).includes(filter))&&(group==='all'||row.sampling_group===group);});}

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
    const detail=$('qa-detail');detail.replaceChildren(element('h3',row.title),element('p',`${row.sampling_group} · ${row.scenario_id}`,'detail-meta'),element('div','用户诉求','speaker'),markdown(row.query,'text-block question-text'),element('div','助手回答','speaker answer'),markdown(row.answer));
    const sessionButton=element('button','查看完整会话 ↗','quiet');sessionButton.onclick=()=>{
      const content=[element('p',`Session ${row.session_id}`,'mono')];
      for(const turn of data.rows.filter(r=>r.session_id===row.session_id).sort((a,b)=>a.turn_id-b.turn_id)){
        content.push(element('h3',`${turn.id}${turn.id===row.id?' · 当前 Query':''}`),element('div','用户诉求','speaker'),markdown(turn.query,'text-block question-text'),element('div','助手回答','speaker answer'),markdown(turn.answer));
      }
      openInfo('完整会话',content);
    };detail.prepend(sessionButton);
    if(row.reference_material){
      const reference=element('details',undefined,'reference-panel');reference.append(element('summary','数据集配对参考答案'),element('p','仅供核验对照，未作临床审核；DSH 生成回答时未看到此答案。','detail-meta'),markdown(row.reference_material.answer));
      const source=element('a',`查看来源 · CSV 第 ${row.reference_material.csv_record_index} 条记录`,'quiet');source.href=row.reference_material.source_url;source.target='_blank';source.rel='noopener noreferrer';reference.append(source);detail.append(reference);
    }
    if(row.previous_turns.length){const previous=element('details');previous.append(element('summary',`查看前 ${row.previous_turns.length} 轮上下文`));for(const turn of row.previous_turns)previous.append(element('div','用户诉求','speaker'),markdown(turn.query,'history-copy'),element('div','助手回答','speaker answer'),markdown(turn.answer,'history-copy'));detail.append(previous);}
    if(mode==='history'&&row.spotcheck_note){const note=element('details');note.append(element('summary','查看 Codex 历史抽查笔记'),markdown(row.spotcheck_note+'（非 Jev 输出，非医学审核）','note-review'));detail.append(note);}
    detail.scrollTop=0;selectedRendered=`${mode}:${selectedId}`;
  }
  renderJudgments();
}

function renderAuditEvidence(){
 const row=rows.get(selectedId),item=selectedItem(),answers=answersOf(item),container=$('audit-evidence');
 container.replaceChildren();container.hidden=FIELDS!==V3_FIELDS||!row;
 if(container.hidden)return;
 container.append(element('h3','核验依据与改进方向'));
 const old=data.baseline?.items.find(i=>i.rowId===row.id);
 if(old)container.append(element('p',`旧规则：${signals(answersOf(old)).queues.includes('badcase_candidate')?'命中候选':'未命中'} · 当前：${signals(answers).queues.includes('badcase_candidate')?'命中候选':'未命中'}`,'detail-meta'));
 container.append(element('p','片段、资料摘要与改进方向由产品审阅整理；分类与概率来自 JEV。专项标签针对整条 QA，不表示每个片段均有问题。','detail-meta'));
 for(const focus of [...(row.review_focus??[]),...(row.product_review??[])]){
  const answer=answers[focus.dimension],card=element('details',undefined,'audit-card');card.open=isIssue(answer);
  card.append(element('summary',focus.title+' · 本条QA：'+(LABELS[answer?.choice]??'待评估')),element('blockquote',focus.quote),element('p','核查点：'+focus.check),element('p',focus.author,'detail-meta'));
  for(const id of focus.source_ids){const e=row.clinical_evidence.find(e=>e.id===id);if(!e)continue;const a=element('a',e.title);a.href=e.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a,element('p',e.summary),element('p','适用条件：'+e.applicability,'detail-meta'));}
  card.append(element('p','产品影响（待复核）：'+focus.impact),element('p','改进方向：'+focus.improvement));container.append(card);
 }
 const extra=Object.entries(answers).filter(([key,a])=>isIssue(a)&&![...(row.review_focus??[]),...(row.product_review??[])].some(f=>f.dimension===key));
 for(const [key,a] of extra)container.append(element('p',`${TITLES[key]}：${LABELS[a.choice]}。展开上方对应维度查看判断标准，对照左侧完整回答复核。`));
 if(!row.clinical_evidence?.length)container.append(element('p','本条未做专项医学资料检索；无问题标签不代表医学正确性已验证。','detail-meta'));
}

function initializeJudgments(){
  for(const field of FIELDS){
    const details=element('details',undefined,'judgment waiting');
    const summary=element('summary'),dimension=element('span',TITLES[field],'dimension');
    const center=element('div'),line=element('div',undefined,'label-value'),label=element('span','等待评估'),flag=element('small');line.append(label,flag);
    const track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');track.append(fill);center.append(line,track);
    const probability=element('span','—','probability');summary.append(dimension,center,probability);
    const options=element('div',undefined,'probability-options'),note=element('p',fieldNotes[field]??data.contract.questions.qa[field]?.instructions??'独立维度判断','judge-note');details.append(summary,options,note);$('judgments').append(details);
    judgmentNodes.set(field,{details,label,flag,fill,probability,options});
  }
}
function renderJudgments(){
  const item=selectedItem(),answers=answersOf(item),uncertain=signals(answers).uncertain;
  const signature=JSON.stringify([selectedId,mode,item?.modes]);if(signature===lastJudgeSignature)return;lastJudgeSignature=signature;renderAuditEvidence();
  $('judgment-meta').textContent=`${Object.keys(answers).length} / ${FIELDS.length} 判断`;
  for(const field of FIELDS){
    const node=judgmentNodes.get(field),answer=answers[field],job=item?.modes[FIELDS.indexOf(field)<3?'query':'qa'];
    node.details.classList.toggle('uncertain',uncertain.includes(field));node.details.classList.toggle('issue',isIssue(answer));node.details.classList.toggle('waiting',!answer);node.details.classList.toggle('running',['running','retrying'].includes(job?.status));
    if(answer?.applicable===false){node.label.textContent='未专项核验';node.flag.textContent='缺少资料，未采纳模型标签';node.fill.style.width='0%';node.probability.textContent='—';node.options.replaceChildren(element('p','这项原始模型输出因缺少专项资料未被采纳，也不计入 badcase；可在输入与记录中查看。'));continue;}
    if(!answer){node.label.textContent=job?.status==='failed'?'调用失败':job?.status==='retrying'?'等待重试':job?.status==='running'?'正在判断…':'等待评估';node.flag.textContent='';node.probability.textContent='—';node.fill.style.width='0%';node.options.replaceChildren(element('p',job?.error??'该维度尚未返回结果。','muted'));continue;}
    const p=answer.type==='choice'?answer.probabilities[answer.choice]:answer.probability;
    node.label.textContent=answer.type==='choice'?(LABELS[answer.choice]??answer.choice):'明确不满的概率';node.flag.textContent=isIssue(answer)?'问题候选':uncertain.includes(field)?'需复核':'';node.probability.textContent=pct(p);node.fill.style.width=pct(p);
    node.options.replaceChildren();
    const distribution=answer.type==='choice'?Object.entries(answer.probabilities).sort((a,b)=>b[1]-a[1]):[['是',answer.probability],['否',1-answer.probability]];
    for(const [key,value] of distribution){const option=element('div',undefined,'probability-option'),track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');fill.style.width=pct(value);track.append(fill);option.append(element('span',LABELS[key]??key),track,element('span',pct(value)));node.options.append(option);}
  }
}

function renderList(){
  const focused=document.activeElement;
  const list=filteredItems(),fragment=document.createDocumentFragment();
  $('distribution-filter').hidden=!distributionFilter;$('distribution-filter-label').textContent=distributionFilter?`${distributionFilter.label} · ${list.length} 条 QA`:'';
  $('qa-counter').textContent=`${list.length} / ${mode==='history'?data.rows.length:items().length} QA`;
  for(const item of list){
    const row=rows.get(item.rowId),status=itemStatus(item),answers=answersOf(item),uncertain=signals(answers).uncertain;
    let node=cards.get(row.id);
    if(!node){node=element('button',undefined,'qa-card');node.type='button';node.addEventListener('click',()=>selectRow(row.id));cards.set(row.id,node);}
    const signature=JSON.stringify([status,answers,mode]);
    if(node.dataset.signature!==signature){
      node.dataset.signature=signature;
      const top=element('div',undefined,'qa-card-top');top.append(element('span',row.id,'mono'),element('span',statusNames[status],'status '+status));
      const strips=element('div',undefined,'signals');strips.setAttribute('aria-hidden','true');for(const field of FIELDS)strips.append(element('i',undefined,!answers[field]?'pending':isIssue(answers[field])?'bad':uncertain.includes(field)?'warn':''));
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
  const latency=itemProviderDuration(item);
  $('metric-latency').textContent=latency===null?'—':latency<1000?Math.round(latency):(latency/1000).toFixed(2);$('latency-unit').textContent=latency===null?'':latency<1000?'ms':'s';
  $('metric-latency').title='所选 QA 的两次成功上游调用合计；不等于本地端到端耗时或纯模型推理耗时。';
  const active=MODES.map(m=>[m,item?.modes[m]]).find(([,job])=>job?.status==='running');
  $('metric-latency-note').textContent=active?'正在评估':latency!==null?'当前 QA · 两次调用合计':'等待耗时记录';
  const pending=mode==='history'?data.rows.length-data.history.items.filter(i=>itemStatus(i)==='completed').length:total-stats.completed;
  $('subtitle').textContent=`待评估 ${pending} 条`;
  $('metric-elapsed').textContent=duration(stats.providerDurationMs);$('elapsed-label').textContent='JEV 累计上游耗时';$('metric-elapsed-note').textContent=stats.providerDurationMs===null?`${stats.providerDurationKnown}/${stats.requests} 次有耗时记录`:'已完成请求累计';
  $('metric-elapsed').title='累计成功上游调用的耗时，不含本地限流等待、暂停和补跑间隔；并发请求分别累加。';$('metric-review').textContent=FIELDS!==LEGACY_FIELDS?stats.badcases:stats.uncertain;
}

function renderDistributions(){
  const all=items(),completed=all.filter(i=>itemStatus(i)==='completed'),stats=metrics(all);$('distribution-count').textContent=`${completed.length} QA`;
  const columns=FIELDS!==LEGACY_FIELDS?[{title:'医学正确性',field:'clinical_correctness'},{title:'参考答案对照',field:'reference_alignment'},{title:'问题分布',counts:{badcase_candidate:stats.badcases,medical_risk:stats.medicalRisks,experience_issue:stats.experienceIssues,reference_conflict:stats.referenceConflicts,uncertain:stats.uncertain}}]:[{title:'服务范围',field:'service_scope'},{title:'能力覆盖',field:'capability_coverage'},{title:'产品信号',counts:{capability_gap_candidate:stats.gaps,badcase_candidate:stats.badcases,uncertain:stats.uncertain}}];
  $('distribution').replaceChildren();
  for(const column of columns){const node=element('div',undefined,'distribution-column');node.append(element('h3',column.title));const counts=column.counts??{};
    if(column.field)for(const item of all){const choice=answersOf(item)[column.field]?.choice;if(choice)counts[choice]=(counts[choice]??0)+1;}
    const values=Object.entries(counts).sort((a,b)=>b[1]-a[1]);const base=Math.max(1,...values.map(([,n])=>n));
    if(!values.length)node.append(element('div','等待结果','mono'));
    for(const [key,count] of values){
      const label=column.field?(LABELS[key]??key):(QUEUES[key]??key);
      const filter=column.field?{field:column.field,value:key}:{queue:key};
      const row=element('button',undefined,'distribution-row'),line=element('div',undefined,'line'),track=element('div',undefined,'bar-track'),fill=element('i',undefined,'bar-fill');
      row.type='button';row.disabled=count===0;row.setAttribute('aria-label',`查看${column.title} · ${label}的 ${count} 条 QA`);
      row.setAttribute('aria-pressed',String(distributionFilter?.label===`${column.title} · ${label}`));
      row.onclick=()=>{
        distributionFilter={...filter,label:`${column.title} · ${label}`};
        $('search').value='';$('filter').value='all';$('group').value='all';follow=false;
        selectedId=filteredItems()[0]?.rowId??null;render();
        $('qa-list').scrollTop=0;$('distribution-filter').scrollIntoView({behavior:'smooth',block:'nearest'});
        cards.get(selectedId)?.focus({preventScroll:true});
      };
      line.append(element('span',label),element('span',count));fill.style.width=`${count/base*100}%`;track.append(fill);row.append(line,track);node.append(row);
    }
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
function render(){const all=distributionFilter?filteredItems():items();if(follow)selectedId=newestId(all);else if(!all.some(i=>i.rowId===selectedId))selectedId=all[0]?.rowId??null;renderControls();renderList();renderSelection();renderDistributions();updateMetrics();}
function stopReplay(){playing=false;clearInterval(replayTimer);replayTimer=null;}
function startReplay(){
  if(replayCount>=data.rows.length)replayCount=0;playing=true;follow=true;render();
  clearInterval(replayTimer);replayTimer=setInterval(()=>{replayCount=Math.min(data.rows.length,replayCount+1);if(replayCount>=data.rows.length)stopReplay();render();},1000/Number($('speed').value));
}
function setMode(next){stopReplay();distributionFilter=null;mode=next;selectedRendered=null;lastJudgeSignature='';render();}
async function post(url,body={}){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Token':csrf},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error??'操作失败');return value;}
async function action(name){if(requestBusy)return;requestBusy=true;try{const run=await post(`/api/runs/${liveId}/${name}`);runs.set(run.id,run);render();}catch(error){showNotice(error.message,true);}finally{requestBusy=false;}}
function scopeIds(){const scope=$('run-scope').value;const ids=scope==='selected'?[selectedId]:scope==='ten'?data.rows.slice(0,10).map(r=>r.id):scope==='filtered'?filteredItems().map(i=>i.rowId):data.rows.map(r=>r.id);return ids.filter(id=>data.liveEligibleIds.includes(id));}
function showEstimate(){const count=scopeIds().length;$('run-estimate').textContent=`${count} 条 QA / ${count*2} 次请求 / ${count*FIELDS.length} 个判断`;$('confirm-run').disabled=count===0;}
function openInfo(title,content){$('info-title').textContent=title;$('info-body').replaceChildren(...content);$('info-dialog').showModal();}

async function showRules(){
  const run=currentRun();
  const params=new URLSearchParams({runId:run?.id??'current',rowId:selectedId??data.rows[0]?.id??'',dataset:data.datasetId??'legacy'});
  try{
    const response=await fetch('/api/rules?'+params);const rules=await response.json();if(!response.ok)throw new Error(rules.error);
    const content=[element('p',`${rules.source} · ${rules.questionVersion}`),element('h3','产品服务范围')];
    for(const text of rules.productContract.service_scope??[])content.push(element('p',text));
    content.push(element('h3','回答要求'));for(const text of rules.productContract.response_expectations??[])content.push(element('p',text));
    content.push(element('h3','能力定义'));
    const names={basis:'定义依据',text_assistance:'文本咨询',text_summary_in_chat:'对话内摘要',medical_knowledge_retrieval:'医学知识检索',persistent_health_records:'长期健康档案',appointment_or_reminder_execution:'预约与提醒执行',cross_account_sharing:'跨账号分享',hospital_record_access:'医院病历访问',image_reading:'图片理解'};
    for(const [key,value] of Object.entries(rules.productContract.capability_snapshot??{}))content.push(element('p',`${names[key]??key}：${LABELS[value]??(value==='unknown_for_this_request'?'本次请求信息不足':typeof value==='string'?value:JSON.stringify(value))}`));
    for(const [mode,questions] of Object.entries(rules.questions)){
      content.push(element('h3',mode==='query'?'用户诉求判断':'回答质量判断'));
      for(const [field,question] of Object.entries(questions)){
        const block=element('details',undefined,'rule-block');block.open=true;
        block.append(element('summary',`${TITLES[field]??field} · ${question.type==='boolean'?'是非判断':'分类判断'}`),element('p',question.instructions,'rule-instructions'));
        for(const [key,text] of Object.entries(question.criteria??{}))block.append(element('p',`${LABELS[key]??key}：${text}`));
        content.push(block);
      }
    }
    if(rules.clinicalEvidence?.length){content.push(element('h3','本条专项医学证据'));for(const e of rules.clinicalEvidence)content.push(element('h4',e.title),element('p',e.summary),element('p','适用范围：'+e.applicability));}
    if(rules.reviewFocus?.length){content.push(element('h3','传给 JEV 的核查片段'));for(const f of rules.reviewFocus)content.push(element('blockquote',f.quote),element('p',f.check));}
    content.push(element('h3','看板派生信号'),element('p','医学风险、体验问题、判断摇摆与 badcase 候选由代码组合模型结果产生。v0.3 中，缺少专项资料时不采纳专项证据标签；原始模型输出保留。资料检索与核查片段为人工准备，未覆盖所有医学主张。'));
    const raw=element('details',undefined,'rule-block');raw.append(element('summary','查看规则原始 JSON'),element('pre',JSON.stringify(rules,null,2)));content.push(raw);
    openInfo('JEV 判断规则',content);
  }catch(error){showNotice(error.message??'无法加载判断规则',true);}
}

async function boot(){
  const response=await fetch('/api/bootstrap'+(new URLSearchParams(location.search).has('dataset')?'?dataset='+encodeURIComponent(new URLSearchParams(location.search).get('dataset')):''));if(!response.ok)throw new Error('无法加载本地评估数据。');data=await response.json();csrf=data.csrf;FIELDS=data.questionVersion==='medical-evidence-0.3'?V3_FIELDS:data.questionVersion==='medical-reference-0.2'?V2_FIELDS:LEGACY_FIELDS;
  for(const d of data.datasets??[]){const option=element('option',d.name);option.value=d.id;$('dataset-select').append(option);}$('dataset-select').value=data.datasetId??'legacy';
  $('dataset-select').onchange=()=>{location.search='?dataset='+encodeURIComponent($('dataset-select').value);};
  $('run-scope').querySelector('option[value=all]').textContent=`全部 ${data.rows.length} 条 QA · ${data.rows.length*2} 次请求`;
  $('review-metric-label').textContent=FIELDS!==LEGACY_FIELDS?'badcase 候选':'判断摇摆';$('review-metric-note').textContent=FIELDS!==LEGACY_FIELDS?'查看医疗风险与体验问题 ↗':'查看需要复核的 QA ↗';
  rows=new Map(data.rows.map(r=>[r.id,r]));runs=new Map(data.runs.map(r=>[r.id,r]));liveId=data.runs[0]?.id??null;replayCount=data.rows.length;
  for(const [value,text] of Object.entries(QUEUES)){const option=element('option',text);option.value=value;$('filter').append(option);}
  for(const name of ['all',...new Set(data.rows.map(r=>r.sampling_group))]){const option=element('option',name==='all'?'全部主题':name);option.value=name;$('group').append(option);}
  initializeJudgments();
  if(data.baseline){const before=metrics(data.baseline.items),after=metrics(data.history.items);$('comparison').hidden=false;$('comparison').textContent=`同一批 50 条真实回答：旧规则 ${before.badcases} 条 → 本轮 ${after.badcases} 条 badcase 候选 · 全量产品检查，4 条含专项医学证据`;const first=data.history.items.find(i=>signals(answersOf(i)).queues.includes('badcase_candidate'));if(first){selectedId=first.rowId;follow=false;}}
  render();
  $('history-mode').onclick=()=>setMode('history');$('live-mode').onclick=()=>setMode('live');
  $('run-select').onchange=()=>{if(mode==='live'){liveId=$('run-select').value;distributionFilter=null;follow=true;render();}};
  $('replay-play').onclick=()=>{if(playing){stopReplay();renderControls();updateMetrics();}else startReplay();};
  $('show-all').onclick=()=>{stopReplay();replayCount=data.rows.length;render();};$('speed').onchange=()=>{if(playing)startReplay();};
  for(const id of ['search','filter','group'])$(id).addEventListener('input',renderList);
  $('follow').onclick=()=>{follow=true;render();};$('review-metric').onclick=()=>{distributionFilter=null;$('filter').value=FIELDS!==LEGACY_FIELDS?'badcase_candidate':'uncertain';follow=false;selectedId=filteredItems()[0]?.rowId??null;render();};
  $('clear-distribution').onclick=()=>{distributionFilter=null;render();};
  $('rules-button').onclick=showRules;
  $('pause-run').onclick=()=>action('pause');$('resume-run').onclick=()=>action('resume');$('retry-run').onclick=()=>action('retry');$('cancel-run').onclick=()=>action('cancel');
  $('new-run').onclick=()=>{$('run-error').textContent='';showEstimate();$('run-dialog').showModal();};$('run-scope').onchange=showEstimate;
  $('run-form').onsubmit=async event=>{event.preventDefault();$('confirm-run').disabled=true;try{const run=await post('/api/runs',{ids:scopeIds()});runs.set(run.id,run);liveId=run.id;mode='live';distributionFilter=null;follow=true;$('run-dialog').close();$('filter').value='all';$('search').value='';$('group').value='all';render();}catch(error){$('run-error').textContent=error.message;}finally{showEstimate();}};
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
  $('about').onclick=()=>openInfo('如何阅读这个看板',[
    element('h3','结果回放与实时评估'),element('p','结果回放按展示速度逐条呈现已完成的真实判断，不调用模型。顶部成本、单条上游耗时和累计上游耗时来自原始评估记录，不是播放动画的计时。实时评估会创建独立批次，按每 2.5 秒最多启动一次请求调度；暂停会等待当前请求返回。'),
    element('h3','各维度独立判断'),element('p','诉求评估读取问题与产品能力；回答评估读取 DSH 回答及本批可用参考。公开数据集批次增加医学正确性、用药和处置风险、参考对照及用户体验。问题候选需要复核，概率不等于准确率。'),
    element('h3','候选队列的含义'),element('p','选择题最高概率 < 0.60，或前两项差值 < 0.20；布尔题概率在 0.35–0.65 时，进入判断摇摆队列。能力缺口不等于新需求，badcase 候选也需要复核；这些阈值尚未校准，队列可重叠。'),
    element('h3','费用与耗时'),element('p','累计成本汇总网关 cost 字段；缺失显示“未返回”，0 表示网关确实返回零。marketCost 原始值可在记录里查看，不等于实际账单。顶部 Jev 上游耗时为网关记录的两次成功上游调用合计，不是纯模型推理时间或端到端耗时。累计上游耗时按已展示的成功请求逐次相加，不含本地限流等待、暂停及补跑间隔；并发调用分别累加，不代表批次墙钟时间。缺失耗时记录时不显示完整合计。失败请求未返回的费用无法统计。'),
    element('h3','本批样本'),element('p',FIELDS!==LEGACY_FIELDS?'问题取自 Chinese-medical-dialogue-data 固定版本的妇产科与儿科，保留原文，25+25个独立单轮 Session。DSH 只收到问题，参考答案仅提供给 JEV。原仓库未提供逐条真实患者来源证明，参考答案未经临床审核，不是金标准。':'问题为合成情境，回答由本地 DSH 实际生成。历史抽查笔记单独标明，不属于 Jev 输出或医学金标准。'),
  ]);
  $('evidence-button').onclick=()=>{const item=selectedItem(),row=rows.get(selectedId);if(!item||!row)return;openInfo('当前 QA · 输入与请求记录',[
    element('p',`${row.id} · Session ${row.session_id}`),element('h3','模型输入范围'),element('p','裁剪后的产品范围、能力快照、当前问答及必要历史。未发送内部推理、作者预期标签或认证信息。'),
    element('h3','原始记录'),element('pre',JSON.stringify({mode,questionVersion:currentRun()?.questionVersion??data.questionVersion,durationBasis:currentRun()?.durationBasis,modes:item.modes},null,2)),
    element('h3','本批产品能力快照'),element('pre',JSON.stringify(row.product_contract??data.contract.product_contract,null,2)),
  ]);};
  $('download').onclick=()=>{const exported={runId:currentRun()?.id??null,mode,exportedAt:new Date().toISOString(),rows:items().map(item=>({...rows.get(item.rowId),evaluation:item,signals:signals(answersOf(item)),spotcheck_note:mode==='history'?rows.get(item.rowId).spotcheck_note:null}))};const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'})),link=element('a');link.href=url;link.download=`jev-${currentRun()?.id??'unscored'}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const events=new EventSource('/api/events');
  events.onopen=()=>{$('connection').textContent='本地服务已连接';$('connection').classList.remove('offline');};
  events.onerror=()=>{$('connection').textContent='连接中断 · 正在重连';$('connection').classList.add('offline');};
  events.addEventListener('snapshot',event=>{const all=JSON.parse(event.data).filter(r=>r.questionVersion===data.questionVersion&&r.items.every(i=>rows.has(i.rowId)));runs=new Map(all.map(run=>[run.id,run]));if(!liveId)liveId=all[0]?.id??null;if(mode==='live')render();});
  events.addEventListener('run',event=>{const run=JSON.parse(event.data);if(run.questionVersion!==data.questionVersion||!run.items.every(i=>rows.has(i.rowId)))return;runs.set(run.id,run);if(mode==='live'&&run.id===liveId)render();});
  setInterval(()=>{if(mode==='live')updateMetrics();},1000);
}
boot().catch(error=>{showNotice(error.message);$('connection').textContent='加载失败';$('connection').classList.add('offline');$('subtitle').textContent='请确认本地看板服务已启动，然后刷新页面。';});
