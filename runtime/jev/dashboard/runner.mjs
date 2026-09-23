import {EventEmitter} from 'node:events';
import {mkdir,readFile,writeFile,rename,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {buildRequest,runEvaluation,formatEvaluationError} from '../evaluate.mjs';
import {QUESTION_VERSION_V3} from '../questions-v3.mjs';
import {QUESTION_VERSION_V2} from '../questions-v2.mjs';
import {QUESTION_VERSION} from '../questions.mjs';
import {MODES,providerDuration} from './shared.mjs';

const versionOf=state=>state?.evaluation_profile==='medical-evidence-v3'?QUESTION_VERSION_V3:state?.evaluation_profile==='medical-reference-v2'?QUESTION_VERSION_V2:QUESTION_VERSION;
const time=()=>new Date().toISOString();
const number=value=>value===null||value===undefined?null:Number(value);
const transient=status=>[429,500,502,503,504].includes(status);

export class EvaluationRunner extends EventEmitter {
  constructor({directory,states,evaluate=runEvaluation,intervalMs=2500,retryBaseMs=5000}){
    super();Object.assign(this,{directory,states,evaluate,intervalMs,retryBaseMs});
    this.runs=new Map();this.current=null;this.nextRequestAt=0;
  }
  async init(){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    for(const name of await readdir(this.directory)){
      if(!name.endsWith('.json'))continue;
      const run=JSON.parse(await readFile(path.join(this.directory,name),'utf8'));
      if(['running','pausing','cancelling'].includes(run.status)){
        run.status='interrupted';run.message='服务曾中断。已成功的请求保留；结果未知的请求需手动重试。';
        for(const item of run.items)for(const mode of MODES){
          const job=item.modes[mode];
          if(['running','retrying'].includes(job.status)){
            job.status='failed';job.error='请求中断，结果未知；重试可能再次产生费用。';
          }
        }
      }
      this.runs.set(run.id,run);await this.save(run);
    }
  }
  list(){return [...this.runs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async save(run){
    const file=path.join(this.directory,`${run.id}.json`);
    // Serialize writes per run so an in-flight response cannot race a pause request.
    const previous=this.writes?.get(run.id)??Promise.resolve();
    this.writes??=new Map();
    const payload=JSON.stringify(run,null,2)+'\n';
    const write=previous.catch(()=>{}).then(async()=>{await writeFile(file+'.tmp',payload,{mode:0o600});await rename(file+'.tmp',file);});
    this.writes.set(run.id,write);await write;
  }
  async publish(run){run.updatedAt=time();await this.save(run);this.emit('update',structuredClone(run));}
  assertAvailable(id){
    if(this.current&&this.current!==id)throw new Error('另一批评估尚在运行，请先暂停或结束它。');
  }
  async create(ids){
    this.assertAvailable();
    if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>!this.states.has(id)))throw new Error('请选择 1–100 条有效且不重复的 QA。');
    const versions=new Set(ids.map(id=>versionOf(this.states.get(id))));
    if(versions.size!==1)throw new Error('不能在一个批次混用不同评估规则');
    const run={id:randomUUID(),name:`评估 ${new Date().toLocaleString('zh-CN',{hour12:false})}`,kind:'live',status:'running',
      createdAt:time(),startedAt:time(),endedAt:null,questionVersion:[...versions][0],durationBasis:'request_time_excluding_dispatch_wait',
      items:ids.map(rowId=>({rowId,ignoredFields:this.states.get(rowId)?.evaluation_profile==='medical-evidence-v3'&&!this.states.get(rowId)?.clinical_evidence?.length?['evidence_consistency']:[],modes:Object.fromEntries(MODES.map(mode=>[mode,{status:'queued',attempts:0}]))}))};
    this.runs.set(run.id,run);this.current=run.id;
    await this.publish(run);this.launch(run);return run;
  }
  launch(run){
    this.pump(run).catch(async()=>{
      run.status='interrupted';run.message='本地评估任务中断，已完成结果保留，请检查服务日志。';
      this.current=null;await this.publish(run);
    }).catch(error=>console.error('Could not persist interrupted batch:',error.code??error.name));
  }
  async action(id,action){
    const run=this.runs.get(id);if(!run)throw new Error('批次不存在。');
    if(action==='pause'){
      if(run.status!=='running')throw new Error('当前批次不在运行。');
      run.status='pausing';run.message='等待当前请求结束后暂停。';await this.publish(run);
    }else if(action==='cancel'){
      if(run.status==='completed')throw new Error('批次已经完成。');
      run.status=this.current===id?'cancelling':'cancelled';
      run.message='已结束调度，已完成的结果会保留。';
      if(run.status==='cancelled')run.endedAt=time();await this.publish(run);
    }else if(action==='resume'||action==='retry'){
      this.assertAvailable(id);
      for(const item of run.items){
        const state=this.states.get(item.rowId);
        if(!state)throw new Error('当前批次输入不可用，请创建新批次。');
        if(versionOf(state)!==run.questionVersion)throw new Error('评估规则已变更，请创建新批次。');
        for(const mode of MODES){const expected=item.modes[mode].inputSha256??item.modes[mode].result?.inputSha256;
          if(expected&&expected!==createHash('sha256').update(JSON.stringify(buildRequest(state,mode))).digest('hex'))throw new Error('评估规则已变更，请创建新批次。');}
      }
      if(this.current===id||!['paused','interrupted','completed_with_errors','cancelled'].includes(run.status))throw new Error('当前状态不能继续。');
      if(action==='retry')for(const item of run.items)for(const mode of MODES){
        const job=item.modes[mode];if(job.status==='failed'){job.status='queued';delete job.error;}
      }
      if(!run.items.some(item=>MODES.some(mode=>item.modes[mode].status==='queued')))throw new Error('没有待处理请求；如有失败项，请选择重试失败项。');
      run.status='running';run.endedAt=null;run.message=null;this.current=id;
      await this.publish(run);this.launch(run);
    }else throw new Error('不支持的操作。');
    return run;
  }
  async dispatchWait(run,until){
    while(Date.now()<until){if(run.status!=='running')return false;await sleep(Math.min(200,until-Date.now()));}
    return run.status==='running';
  }
  async pump(run){
    for(const item of run.items){
      for(const mode of MODES){
        const job=item.modes[mode];if(job.status!=='queued')continue;
        if(!await this.dispatchWait(run,this.nextRequestAt))break;
        const request=buildRequest(this.states.get(item.rowId),mode);
        const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
        if(job.inputSha256&&job.inputSha256!==fingerprint)throw new Error('恢复时评估输入已变化，请创建新批次。');
        job.inputSha256=fingerprint;
        let retries=0;
        while(run.status==='running'){
          if(!await this.dispatchWait(run,this.nextRequestAt))break;
          const started=Date.now();this.nextRequestAt=started+this.intervalMs;
          job.status='running';job.attempts++;job.startedAt=time();delete job.retryAt;
          await this.publish(run);
          const requestStarted=Date.now();
          try{
            const result=await this.evaluate(request);
            if(result.input_sha256!==job.inputSha256)throw new Error('评估结果与输入指纹不一致。');
            job.status='completed';job.result={answers:result.answers,durationMs:Date.now()-requestStarted,providerDurationMs:providerDuration(result.gateway),
              evaluatedAt:result.evaluated_at,cost:number(result.gateway?.cost),marketCost:number(result.gateway?.marketCost),
              usage:result.usage,questionVersion:result.question_version,inputSha256:result.input_sha256};
            delete job.error;await this.publish(run);break;
          }catch(error){
            const status=error?.statusCode??error?.cause?.statusCode;
            job.httpStatus=status??null;
            job.error=status===429?'网关限流，等待后重试。':status>=500?'上游服务暂时不可用，等待后重试。':formatEvaluationError(error);
            if(transient(status)&&retries<3&&run.status==='running'){
              retries++;
              const headers=error.responseHeaders??error.cause?.responseHeaders??{};
              const seconds=Number(headers['retry-after']);
              const delay=Math.max(Number.isFinite(seconds)?seconds*1000:0,this.retryBaseMs*retries);
              this.nextRequestAt=Math.max(this.nextRequestAt,Date.now()+delay);
              job.status='retrying';job.retryAt=new Date(this.nextRequestAt).toISOString();await this.publish(run);
              continue;
            }
            job.status='failed';await this.publish(run);
            if(status===401||status===403){run.status='pausing';run.message='网关凭据或访问条件需要处理，批次已暂停。';}
            break;
          }
        }
        if(['retrying','running'].includes(job.status))job.status='queued';
        if(run.status!=='running')break;
      }
      if(run.status!=='running')break;
    }
    if(run.status==='pausing'){run.status='paused';if(run.message==='等待当前请求结束后暂停。')run.message='已暂停，可继续处理剩余请求。';}
    else if(run.status==='cancelling'){run.status='cancelled';run.endedAt=time();}
    else if(run.status==='running'){
      run.status=run.items.some(item=>MODES.some(mode=>item.modes[mode].status==='failed'))?'completed_with_errors':'completed';
      run.endedAt=time();run.message=run.status==='completed'?'本批评估已完成。':'本批存在调用失败，可只重试失败项。';
    }
    this.current=null;await this.publish(run);
  }
}
