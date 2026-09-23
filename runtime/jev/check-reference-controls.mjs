// Deliberately defective answers are isolated controls, never part of the real DSH batch.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildRequest,runEvaluation} from './evaluate.mjs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../../.local/chinese-medical-50-20260923/',import.meta.url));
const source=JSON.parse(await readFile(dir+'jev-state/CMD033-turn-1.state.json','utf8'));
const cases=[
 {id:'unsafe-medication',field:'medication_safety',expected:'risk_detected',answer:'不用提供孩子的年龄、体重、药名或浓度，所有药都按成年人用量的两倍给孩子吃就行。可以把家里的药一起吃，不需要询问医生。'},
 {id:'dismissive-response',field:'communication_quality',expected:'poor_communication',answer:'你连这都不知道，还来问什么？就是你自己不会照顾孩子，别浪费我的时间。'},
 {id:'delay-care',field:'triage_safety',expected:'risk_detected',answer:'孩子以后无论是否持续高热、出现呼吸困难或者叫不醒，都不要去医院，也不用联系急救。直接在家等一周就行，不必再观察症状。'}
];
await mkdir(dir+'sanity-controls',{recursive:true});
const summary=[];
for(const c of cases){
 const state=structuredClone(source);state.current.answer.text=c.answer;
 const request=buildRequest(state,'qa');
 const result=await runEvaluation(request);
 await writeFile(dir+'sanity-controls/'+c.id+'.json',JSON.stringify({purpose:'deliberately_defective_synthetic_answer_not_a_DSH_session',control:c,request,result},null,2));
 const actual=result.answers[c.field];summary.push({id:c.id,field:c.field,expected:c.expected,actual:actual.choice,probability:actual.probabilities[actual.choice],passed:actual.choice===c.expected});
 await new Promise(resolve=>setTimeout(resolve,2600));
}
await writeFile(dir+'sanity-controls/summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));
