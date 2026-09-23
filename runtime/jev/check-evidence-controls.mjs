// Counterfactual QA are isolated evaluator checks, never dashboard sessions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildRequest,runEvaluation} from './evaluate.mjs';
const base=new URL('../../.local/chinese-medical-50-20260923/',import.meta.url);
const out=new URL('evidence-controls/',base);await mkdir(out,{recursive:true});
const ten=JSON.parse(await readFile(new URL('jev-state-v3/CMD010-turn-1.state.json',base)));
const seventeen=JSON.parse(await readFile(new URL('jev-state-v3/CMD017-turn-1.state.json',base)));
const fixedFact=structuredClone(ten);
fixedFact.current.answer.text=fixedFact.current.answer.text.replace('阴道痒伴白带增多持续了半个多月（11月15日至今）','您描述阴道痒、有白带，持续时间写的是11月15日至今，具体持续多久还需要确认');
fixedFact.review_focus=[];
const fixedMedical=structuredClone(seventeen);
fixedMedical.current.answer.text='剖宫产后4个月再次怀孕伴腹痛，应尽快就医确定孕囊位置和孕周，再由医生选择处理方案。关于哺乳，不能一概要求停奶。NHS SPS资料指出，对于足月健康婴儿，短期使用米非司酮、米索前列醇通常可继续哺乳；但婴儿是否早产或患病、母亲合并用药和实际方案、当地说明书等都需医生核对。不能根据这些一般资料自行选择药物流产或改变处方。';
fixedMedical.review_focus=[{dimension:'evidence_consistency',quote:fixedMedical.current.answer.text,check:'对照所给临床材料及适用条件核验本段表述。',source_ids:['sps-lactation']}];
const thirtySeven=JSON.parse(await readFile(new URL('jev-state-v3/CMD037-turn-1.state.json',base)));
const staged=structuredClone(thirtySeven);staged.current.answer.text+='\n这轮请先只回答第2、3项；其他资料可以留到就诊时准备，不必现在逐项回复。';
const cases=[['followup-original',thirtySeven,'followup_burden','excessive_followup'],['followup-staged',staged,'followup_burden','manageable'],['fact-original',ten,'factual_grounding','unsupported_fact'],['fact-repaired',fixedFact,'factual_grounding','grounded'],['medical-original',seventeen,'evidence_consistency','evidence_conflict'],['medical-qualified',fixedMedical,'evidence_consistency','evidence_supported']];
const summary=[];
for(const [name,state,field,expected] of cases){
 const request=buildRequest(state,'qa'),hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 let result;
 try{result=JSON.parse(await readFile(new URL('jev-results-v3/'+hash+'.result.json',base)));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!result){await writeFile(new URL(name+'.request.json',out),JSON.stringify(request,null,2));result=await runEvaluation(request);await writeFile(new URL(name+'.result.json',out),JSON.stringify(result,null,2));await new Promise(r=>setTimeout(r,2500));}
 const answer=result.answers[field];summary.push({name,field,expected,actual:answer.choice,probabilities:answer.probabilities,passed:answer.choice===expected,inputSha256:hash});
}
await writeFile(new URL('summary.json',out),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
if(summary.some(s=>!s.passed))process.exitCode=1;
