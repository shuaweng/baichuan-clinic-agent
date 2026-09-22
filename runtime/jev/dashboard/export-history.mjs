import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {providerDuration} from './shared.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const base=path.join(root,'.local/maternal-fresh-50-20260922/jev-results-v1');
const data=path.join(root,'data/session-batch-50');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const manifest=await read(path.join(base,'manifest.json'));
const rows=(await readFile(path.join(data,'jev-labels.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
const number=value=>value===undefined||value===null?null:Number(value);
const items=[];
for(const row of rows){
  const item={rowId:row.id,modes:{}};
  for(const mode of ['query','qa']){
    const id=`${row.id}-${mode}`;
    const request=await read(path.join(base,`${id}.request.json`));
    const result=await read(path.join(base,`${id}.result.json`));
    const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    if(result.status!=='evaluated'||hash!==result.input_sha256||hash!==row.provenance[mode].input_sha256)throw new Error(`Invalid historical result: ${id}`);
    item.modes[mode]={status:'completed',result:{
      answers:result.answers,durationMs:result.duration_ms,evaluatedAt:result.evaluated_at,
      providerDurationMs:providerDuration(result.gateway),
      cost:number(result.gateway?.cost),marketCost:number(result.gateway?.marketCost),usage:result.usage,
      questionVersion:result.question_version,inputSha256:hash,
    }};
  }
  items.push(item);
}
items.sort((a,b)=>Math.max(...Object.values(a.modes).map(m=>Date.parse(m.result.evaluatedAt)))-Math.max(...Object.values(b.modes).map(m=>Date.parse(m.result.evaluatedAt))));
const history={id:'baseline-v1',name:'首批 50 个 Session',status:'completed',kind:'history',
  startedAt:manifest.created_at,endedAt:new Date(Math.max(...items.flatMap(i=>Object.values(i.modes).map(m=>Date.parse(m.result.evaluatedAt))))).toISOString(),
  questionVersion:manifest.question_version,durationBasis:'recorded_attempt_including_dispatch_wait',items};
await writeFile(path.join(data,'jev-timeline.json'),JSON.stringify(history,null,2)+'\n');
console.log(`Exported ${items.length} QA / ${items.length*2} verified requests. No model calls.`);
