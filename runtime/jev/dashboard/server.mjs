import {reviewData,decision,startReview} from '../../review/api.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {EvaluationRunner} from './runner.mjs';
import {buildRequest} from '../evaluate.mjs';
import {QUESTION_VERSION} from '../questions.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const DATA=path.join(ROOT,'data/session-batch-50');
const json=async file=>JSON.parse(await readFile(file,'utf8'));

export async function loadDataset(id='legacy'){
  if(['physician','physician-100'].includes(id)){
    const dir=path.join(ROOT,id==='physician-100'?'data/physician-tasks-100':'data/physician-tasks-50');
    const rows=(await readFile(path.join(dir,'jev-labels.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const scenarios=(await readFile(path.join(dir,'scenarios.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    let notes={};try{notes=await json(path.join(dir,'jev-product-review.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const row of rows){row.title=scenarios.find(s=>s.scenario_id===row.scenario_id)?.title??row.title;row.spotcheck_note=notes[row.id]?.note;}
    const history=await json(path.join(dir,'jev-timeline.json'));
    const contract=await json(path.join(dir,'jev-evaluation-contract.json'));
    try{const inputs=await json(path.join(dir,'evaluation-inputs.json'));for(const input of inputs){if(rows.some(r=>r.id===input.id))continue;const scenario_id=input.id.split('-turn-')[0],scenario=scenarios.find(s=>s.scenario_id===scenario_id);rows.push({id:input.id,title:scenario?.title??input.task_contract.task_type,scenario_id,sampling_group:scenario?.sampling_group??input.agent_preset,session_id:input.session_id,turn_id:Number(input.id.split('-turn-')[1]),query:input.current.query.text,answer:input.current.answer.text,previous_turns:input.history,agent_preset:input.agent_preset,evaluation_status:'pending'});history.items.push({rowId:input.id,evaluationModes:['qa'],modes:{qa:{status:'queued'}}});}rows.sort((a,b)=>a.scenario_id.localeCompare(b.scenario_id)||a.turn_id-b.turn_id);}catch(error){if(error.code!=='ENOENT')throw error;}
    return {id,readOnly:true,name:'医生场景 · '+new Set(rows.map(r=>r.session_id)).size+' 个 Session',rows,history,contract,states:new Map(),baseline:null};
  }
  if(!['legacy','public-medical','public-medical-v2'].includes(id))throw new Error('Unknown dataset');
  const dataPath=id==='legacy'?DATA:path.join(ROOT,'data/chinese-medical-50');
  const statePath=id==='legacy'?'maternal-fresh-50-20260922':'chinese-medical-50-20260923';
  const rows=(await readFile(path.join(dataPath,'jev-labels.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const v3=id==='public-medical';
  const history=await json(path.join(dataPath,v3?'jev-timeline-v3.json':'jev-timeline.json'));
  const contract=await json(path.join(dataPath,v3?'jev-evaluation-contract-v3.json':'jev-evaluation-contract.json'));
  if(v3)rows.splice(0,rows.length,...(await readFile(path.join(dataPath,'jev-audit-rows.jsonl'),'utf8')).trim().split('\n').map(JSON.parse));
  const states=new Map();
  for(const row of rows){
    try{
      const state=await json(path.join(ROOT,'.local',statePath,v3?'jev-state-v3':'jev-state',`${row.id}.state.json`));
      for(const mode of ['query','qa'])buildRequest(state,mode);
      if(state.current.query.text!==row.query||state.current.answer.text!==row.answer)throw new Error(`QA source mismatch: ${row.id}`);
      states.set(row.id,state);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  // Historical answers belong to history.items, not to yet-unscored live rows.
  const samples=rows.map(({id,title,scenario_id,sampling_group,session_id,turn_id,query,answer,previous_turns,spotcheck_note,reference_material,product_contract,agent_preset,provenance,review_focus,clinical_evidence,product_review})=>
    ({id,title,scenario_id,sampling_group,session_id,turn_id,query,answer,previous_turns,spotcheck_note,reference_material,product_contract,agent_preset,provenance,review_focus,clinical_evidence,product_review}));
  const baseline=v3?await json(path.join(dataPath,'jev-timeline.json')):null;
  return {id,readOnly:id==='public-medical-v2',name:id==='legacy'?'合成场景 · 旧批次':v3?'公开妇幼问题 · 证据复评 v0.3':'公开妇幼问题 · 旧规则 v0.2',rows:samples,history,contract,states,baseline};
}

export function createDashboardServer({dataset,datasets=[dataset],runner,apiConfigured=Boolean(process.env.AI_GATEWAY_API_KEY?.trim())}){
  const csrf=randomBytes(24).toString('hex');
  const clients=new Set();
  const staticFiles={
    '/':['public/index.html','text/html; charset=utf-8'],
    '/review':['public/review.html','text/html; charset=utf-8'],
    '/review.js':['public/review.js','text/javascript; charset=utf-8'],
    '/review.css':['public/review.css','text/css; charset=utf-8'],
    '/app.js':['public/app.js','text/javascript; charset=utf-8'],
    '/style.css':['public/style.css','text/css; charset=utf-8'],
    '/shared.mjs':['shared.mjs','text/javascript; charset=utf-8'],
    '/markdown.mjs':['markdown.mjs','text/javascript; charset=utf-8'],
    '/vendor/markdown-it.min.js':['../node_modules/markdown-it/dist/markdown-it.min.js','text/javascript; charset=utf-8'],
    '/logo.png':[path.join(ROOT,'assets/branding/baichuan-medical-logo-hd.png'),'image/png'],
  };
  const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    const port=server.address().port;
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){send(res,403,{error:'Invalid local host'});return;}
    if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin)){send(res,403,{error:'只接受本地看板的请求。'});return;}
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    try{
      if(req.method==='GET'&&['/api/bootstrap','/api/rules'].includes(url.pathname)){
        for(const id of ['physician','physician-100']){try{const fresh=await loadDataset(id);const index=datasets.findIndex(d=>d.id===id);if(index<0)datasets.push(fresh);else datasets[index]=fresh;}catch(error){if(error.code!=='ENOENT')throw error;}}
      }
      if(req.method==='GET'&&url.pathname==='/api/review'){send(res,200,{...await reviewData(url.searchParams.get('dataset')??'physician'),csrf});return;}
      if(req.method==='GET'&&url.pathname==='/api/rules'){
        const rowId=url.searchParams.get('rowId'),runId=url.searchParams.get('runId');
        const ruleDataset=datasets.find(d=>d.history.id===runId&&d.rows.some(row=>row.id===rowId))??datasets.find(d=>d.id===url.searchParams.get('dataset')&&d.rows.some(row=>row.id===rowId))??datasets.find(d=>!d.readOnly&&d.rows.some(row=>row.id===rowId));
        if(!ruleDataset){send(res,404,{error:'QA 不存在。'});return;}
        const dataset=ruleDataset;
        if(!dataset.rows.some(row=>row.id===rowId)){send(res,404,{error:'QA 不存在。'});return;}
        if(runId===dataset.history.id){
          send(res,200,{source:'历史批次规则快照',questionVersion:dataset.contract.question_version,
            productContract:dataset.rows.find(r=>r.id===rowId)?.product_contract??dataset.contract.product_contract,questions:dataset.contract.questions,clinicalEvidence:dataset.rows.find(r=>r.id===rowId)?.clinical_evidence??[],reviewFocus:(dataset.rows.find(r=>r.id===rowId)?.review_focus??[]).map(({dimension,quote,check,source_ids})=>({dimension,quote,check,source_ids}))});return;
        }
        const run=runner.list().find(run=>run.id===runId);
        const item=run?.items.find(item=>item.rowId===rowId);
        if(runId!=='current'&&!item){send(res,404,{error:'当前批次没有这条 QA。'});return;}
        const state=dataset.states.get(rowId);
        if(!state){send(res,404,{error:'没有可用的规则输入。'});return;}
        const requests=Object.fromEntries(['query','qa'].map(mode=>[mode,buildRequest(state,mode)]));
        for(const [mode,request] of Object.entries(requests)){
          const expected=item?.modes[mode]?.inputSha256??item?.modes[mode]?.result?.inputSha256;
          if(expected&&expected!==createHash('sha256').update(JSON.stringify(request)).digest('hex')){
            send(res,409,{error:'当前配置与这条历史请求不同，无法还原当时的判断规则。'});return;
          }
        }
        send(res,200,{source:item?'本批请求规则（已发请求已校验输入指纹）':'待发送的判断规则',questionVersion:run?.questionVersion??dataset.contract.question_version??QUESTION_VERSION,
          productContract:requests.query.state.product_contract,questions:{query:requests.query.questions,qa:requests.qa.questions},clinicalEvidence:requests.qa.state.clinical_evidence??[],reviewFocus:requests.qa.state.review_focus??[]});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/bootstrap'){
        const selected=url.searchParams.get('dataset');const active=datasets.find(d=>d.id===(selected??dataset.id));
        if(!active){send(res,404,{error:'数据批次不存在'});return;}
        send(res,200,{rows:active.rows,history:active.history,contract:active.contract,baseline:active.baseline,runs:runner.list().filter(r=>r.questionVersion===active.contract.question_version&&r.items.every(i=>active.rows.some(row=>row.id===i.rowId))),csrf,
          datasetId:active.id,datasets:datasets.map(d=>({id:d.id,name:d.name})),apiConfigured,liveEligibleIds:active.readOnly?[]:[...active.states.keys()],questionVersion:active.contract.question_version??QUESTION_VERSION});return;
      }
      if(req.method==='GET'&&url.pathname==='/api/events'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});
        clients.add(res);res.write(`event: snapshot\ndata: ${JSON.stringify(runner.list())}\n\n`);
        const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);timer.unref();
        req.on('close',()=>{clearInterval(timer);clients.delete(res);});return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/')){
        const token=Buffer.from(String(req.headers['x-dashboard-token']??''));
        if(token.length!==csrf.length||!timingSafeEqual(token,Buffer.from(csrf))){send(res,403,{error:'请求校验失败，请刷新页面后重试。'});return;}
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384){send(res,413,{error:'请求过大。'});return;}}
        let body;try{body=JSON.parse(raw||'{}');}catch{send(res,400,{error:'无效请求格式。'});return;}
        if(url.pathname==='/api/review/decision'){send(res,200,await decision(body.dataset,body));return;}
        if(url.pathname==='/api/review/run'){send(res,202,await startReview(body.dataset));return;}
        if(url.pathname==='/api/runs'){
          if(!apiConfigured){send(res,409,{error:'请先在项目 .env.local 配置 AI_GATEWAY_API_KEY，再重启看板。'});return;}
          send(res,201,await runner.create(body.ids));return;
        }
        const match=url.pathname.match(/^\/api\/runs\/([a-f0-9-]+)\/(pause|resume|retry|cancel)$/);
        if(match){send(res,200,await runner.action(match[1],match[2]));return;}
      }
      if(req.method==='GET'&&staticFiles[url.pathname]){
        const [file,type]=staticFiles[url.pathname];
        const content=await readFile(path.isAbsolute(file)?file:path.join(HERE,file));
        res.writeHead(200,{'Content-Type':type});res.end(content);return;
      }
      send(res,404,{error:'页面或接口不存在。'});
    }catch(error){
      if(error.code){console.error('Dashboard filesystem error:',error.code);send(res,500,{error:'本地文件读取或保存失败，请检查服务日志。'});}
      else send(res,409,{error:error.message});
    }
  });
  runner.on('update',run=>{const event=`event: run\ndata: ${JSON.stringify(run)}\n\n`;for(const client of clients)client.write(event);});
  server.on('close',()=>{for(const client of clients)client.end();});
  return server;
}

async function main(){
  const legacy=await loadDataset();const datasets=[legacy];
  try{datasets.push(await loadDataset('public-medical-v2'));datasets.push(await loadDataset('public-medical'));}catch(error){if(error.code!=='ENOENT')throw error;}
  try{datasets.push(await loadDataset('physician'));}catch(error){if(error.code!=='ENOENT')throw error;}
  try{datasets.push(await loadDataset('physician-100'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const dataset=datasets.at(-1);
  const runner=new EvaluationRunner({directory:path.join(ROOT,'.local/jev-dashboard/runs'),states:new Map(datasets.filter(d=>!d.readOnly).flatMap(d=>[...d.states]))});
  await runner.init();
  const server=createDashboardServer({dataset,datasets,runner});
  const port=Number(process.env.JEV_DASHBOARD_PORT??3081);
  server.listen(port,'127.0.0.1',()=>console.log(`Jev dashboard ready: http://127.0.0.1:${port} (${dataset.rows.length} QA)`));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('Dashboard startup failed:',error.code??error.message);process.exitCode=1;});
