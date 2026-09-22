import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {EvaluationRunner} from './runner.mjs';
import {buildRequest} from '../evaluate.mjs';
import {QUESTION_VERSION} from '../questions.mjs';

const HERE=fileURLToPath(new URL('.',import.meta.url));
const ROOT=fileURLToPath(new URL('../../../',import.meta.url));
const DATA=path.join(ROOT,'data/session-batch-50');
const json=async file=>JSON.parse(await readFile(file,'utf8'));

export async function loadDataset(){
  const rows=(await readFile(path.join(DATA,'jev-labels.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const history=await json(path.join(DATA,'jev-timeline.json'));
  const contract=await json(path.join(DATA,'jev-evaluation-contract.json'));
  const states=new Map();
  for(const row of rows){
    try{
      const state=await json(path.join(ROOT,'.local/maternal-fresh-50-20260922/jev-state',`${row.id}.state.json`));
      for(const mode of ['query','qa'])buildRequest(state,mode);
      if(state.current.query.text!==row.query||state.current.answer.text!==row.answer)throw new Error(`QA source mismatch: ${row.id}`);
      states.set(row.id,state);
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  // Historical answers belong to history.items, not to yet-unscored live rows.
  const samples=rows.map(({id,title,scenario_id,sampling_group,session_id,turn_id,query,answer,previous_turns,spotcheck_note})=>
    ({id,title,scenario_id,sampling_group,session_id,turn_id,query,answer,previous_turns,spotcheck_note}));
  return {rows:samples,history,contract,states};
}

export function createDashboardServer({dataset,runner,apiConfigured=Boolean(process.env.AI_GATEWAY_API_KEY?.trim())}){
  const csrf=randomBytes(24).toString('hex');
  const clients=new Set();
  const staticFiles={
    '/':['public/index.html','text/html; charset=utf-8'],
    '/app.js':['public/app.js','text/javascript; charset=utf-8'],
    '/style.css':['public/style.css','text/css; charset=utf-8'],
    '/shared.mjs':['shared.mjs','text/javascript; charset=utf-8'],
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
      if(req.method==='GET'&&url.pathname==='/api/bootstrap'){
        send(res,200,{rows:dataset.rows,history:dataset.history,contract:dataset.contract,runs:runner.list(),csrf,
          apiConfigured,liveEligibleIds:[...dataset.states.keys()],questionVersion:QUESTION_VERSION});return;
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
  const dataset=await loadDataset();
  const runner=new EvaluationRunner({directory:path.join(ROOT,'.local/jev-dashboard/runs'),states:dataset.states});
  await runner.init();
  const server=createDashboardServer({dataset,runner});
  const port=Number(process.env.JEV_DASHBOARD_PORT??3081);
  server.listen(port,'127.0.0.1',()=>console.log(`Jev dashboard ready: http://127.0.0.1:${port} (${dataset.rows.length} QA)`));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error('Dashboard startup failed:',error.code??error.message);process.exitCode=1;});
