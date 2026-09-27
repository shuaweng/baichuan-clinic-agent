import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Questions are independent. Keep the identical state and archive each real response.
export async function evaluateInParts(request,evaluatePart){
 const entries=Object.entries(request.questions),parts=[];
 for(let i=0;i<entries.length;i+=4){
  const part={...request,questions:Object.fromEntries(entries.slice(i,i+4))};
  const result=await evaluatePart(part,parts.length);
  if(result.input_sha256!==hash(part)||Object.keys(result.answers).sort().join()!==Object.keys(part.questions).sort().join())throw Error('Split evaluation response mismatch');
  parts.push(result);
 }
 const sum=values=>values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):undefined;
 const cost=key=>{const n=sum(parts.map(p=>p.gateway?.[key]==null?undefined:Number(p.gateway[key])));return n===undefined?undefined:String(n);};
 return {...parts[0],answers:Object.assign({},...parts.map(p=>p.answers)),input_sha256:hash(request),evaluated_at:parts.at(-1).evaluated_at,duration_ms:sum(parts.map(p=>p.duration_ms)),
  usage:Object.fromEntries(['inputTokens','outputTokens','totalTokens'].map(k=>[k,sum(parts.map(p=>p.usage?.[k]))])),
  gateway:{cost:cost('cost'),marketCost:cost('marketCost'),gatewayCost:cost('gatewayCost'),routing:{modelAttempts:parts.flatMap(p=>p.gateway?.routing?.modelAttempts??[])}},
  composition:{strategy:'independent_question_groups_same_full_state',request_count:parts.length,parts:parts.map(p=>({input_sha256:p.input_sha256,generation_id:p.gateway?.generationId,fields:Object.keys(p.answers)}))}};
}
