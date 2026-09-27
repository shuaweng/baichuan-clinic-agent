import {readFile,mkdir,copyFile} from 'node:fs/promises';import path from 'node:path';
import {ROOT,read,save,hash,callModel} from '../runtime/review/core.mjs';import{createHash}from'node:crypto';
const dest=path.join(ROOT,'data/physician-tasks-100'),local=path.join(ROOT,'.local/physician-tasks-100-v1');await mkdir(dest,{recursive:true});await mkdir(local,{recursive:true});
try{const frozen=await read(path.join(dest,'manifest.json'));if(frozen.scenarios_sha256)throw Error('100-session question set already frozen; create a new version to revise it');}catch(e){if(e.code!=='ENOENT')throw e;}
const old=(await readFile(path.join(ROOT,'data/physician-tasks-50/scenarios.jsonl'),'utf8')).trim().split('\n').map(JSON.parse),done=new Set((await read(path.join(ROOT,'data/physician-tasks-50/collection-status.json'))).completed_ids);
const themes=[
['妇科','baichuan-gynecology',['青春期月经记录的就诊摘要','绝经后出血转诊资料清单','宫颈筛查报告的单位与术语核对','多囊卵巢病史里已知与推测分开','哺乳期用药咨询的信息核实','慢性盆腔疼痛转诊函逐步修改','围绝经期症状随访记录合并','避孕方法共同决策的患者价值偏好','孕期超声时间线冲突核查','更年期宣教稿的风险表达']],
['妇科','baichuan-gynecology',['外阴症状问诊中的隐私与中性表达','家族肿瘤史谱系资料整理','生殖辅助检查结果来源核对','备孕既往用药记录与医生待核项','孕期贫血随访报告缺项整理','产后复诊摘要去除未经确认的诊断','异常出血病例跨多次回访资料整理','孕妇拒绝某项检查的沟通脚本','患者误把相对风险当绝对风险','老年女性就诊陪诊与知情同意边界']],
['儿科','baichuan-pediatrics',['早产儿随访资料按矫正年龄整理','儿童生长曲线测量单位冲突','疫苗记录漏项核实与补证','儿童发热电话信息急诊交接','儿童湿疹护理宣教内容审阅','学校注意力观察的中性记录','婴儿喂养日志不同照护者信息合并','青少年访谈保密范围沟通','反复喘息患儿吸入操作教学任务','儿童检验报告超参考区间解释边界']],
['儿科','baichuan-pediatrics',['儿童过敏史明确否认与未询问区分','儿童便秘随访饮食记录','儿童睡眠日记缺失信息核查','儿童运动后胸闷转诊交接','青春期体重谈话避免污名化','新生儿黄疸随访记录日期更正','儿童听力筛查失访追踪文书','婴幼儿发育评估多来源材料冲突','儿童药物浓度教学换算逐次更正','儿童急诊交接生命体征未测']],
['办公模式','baichuan-office',['科室质控分母逐月变化','会议纪要将讨论和决议分离','门诊宣教材料版本审校','教研摘要小样本结果不过度外推','患者满意度问卷的选择偏差','科室排班表约束冲突检查','匿名病例教学材料去标识','数据字典与空值统计口径','院内通知草稿修订与发送权限','文献检索需求转为可复核检索式']]
];
const lengths=[[1,3,1,4,1,10,2,4,6,1],[3,1,2,4,1,6,10,2,3,1],[4,6,1,10,2,3,4,1,6,1],[1,3,1,4,2,6,3,10,4,1],[6,4,1,3,1,10,2,4,3,1]];
const prompt=`你为面向医生/诊室团队的AI产品设计测试对话。请按specs逐一编写完整的预设用户发言序列，输出JSON {"scenarios":[{"scenario_id":"D051","title":"...","sampling_group":"妇科","agent_preset":"baichuan-gynecology","task_type":"病例整理","turns":[{"index":1,"user":"完整的用户发言","expected_checks":["检查点"]}],"evaluation":{"unacceptable_errors":["检查点"],"reference_status":"task_constraints_only","clinical_evidence_required":false}}]}。
严格满足每个spec指定的轮数、ID、主题和模式。场景为虚构医生任务，不是真实病历，不输出助手答案或临床金标准。第一轮明确医生在做的具体工作及必要材料；材料全部内联、匿名、虚构，不要求读取电脑文件或发送信息。1轮能完成的自然结束。长对话是一段连贯工作：新资料、纠正、患者偏好、前后冲突、交付对象变化、阶段汇总等自然发展，不用泛化“继续详细一点”凑轮数。每次补充带主题相关具体内容，别假设前面助手一定说过某句。6-10轮里至少两次跨多轮回忆核对、一次事实更正和一次受众/交付变化；不每轮重复固定前缀。医学建议请求可以有，但不要在检查点编造指南/剂量真值。合理没资料应诚实说明，不要求编造引文。用药换算只用明确虚构的制剂教学数值。每轮中文50-180字，必要材料可略长。每个主题的核心诉求不同，不要全变成同一种摘要格式任务。仅给JSON。`;
for(let b=0;b<themes.length;b++){
 const [group,preset,titles]=themes[b];const specs=titles.map((title,i)=>({scenario_id:'D'+String(51+b*10+i).padStart(3,'0'),title,sampling_group:group,agent_preset:preset,turn_count:lengths[b][i]}));const file=path.join(local,'authored-'+b+'.json');let result;try{result=await read(file);}catch(e){if(e.code!=='ENOENT')throw e;result=await callModel(prompt,{specs},{maxTokens:28000});await save(file,result);}
 const rows=result.content.scenarios;if(rows?.length!==10)throw Error('Need10scenarios');
 for(let i=0;i<rows.length;i++){const r=rows[i],spec=specs[i];if(r.scenario_id!==spec.scenario_id||r.agent_preset!==preset||r.turns?.length!==spec.turn_count)throw Error('Scenario mismatch '+spec.scenario_id);r.sampling_group=group;r.title=spec.title;r.source='research_informed_synthetic_physician_task';r.provenance={kind:'synthetic',real_physician_log:false,question_author_model:result.metadata.model,question_generation_request:result.metadata.request_id,basis:'research/physician-ai-needs-2026-09-23.md'};r.evaluation={...r.evaluation,reference_status:'task_constraints_only',medical_correctness_status:'not_adjudicated'};r.turns.forEach((t,k)=>{if(t.index!==k+1||!t.user?.trim()||!t.expected_checks?.length||'answer'in t)throw Error('Invalidturn');});old.push(r);}
 console.log(JSON.stringify({authored:specs.map(s=>s.scenario_id),turns:rows.reduce((n,r)=>n+r.turns.length,0)}));
}
// Keep all previously collected sessions byte-for-byte; shorten uncollected tasks that already have a complete one-turn deliverable.
for(const r of old.slice(0,50))if(!done.has(r.scenario_id)&&Number(r.scenario_id.slice(1))%2===0)r.turns=r.turns.slice(0,1);
if(old.length!==100||new Set(old.map(r=>r.scenario_id)).size!==100)throw Error('Expected100');
const queries=old.flatMap(r=>r.turns.map(t=>t.user));if(new Set(queries).size!==queries.length)throw Error('Duplicate query');
const content=old.map(r=>JSON.stringify(r)).join('\n')+'\n';const{writeFile}=await import('node:fs/promises');await writeFile(path.join(dest,'scenarios.jsonl'),content);
const manifest=await read(path.join(ROOT,'data/physician-tasks-50/manifest.json'));Object.assign(manifest,{dataset_id:'physician-tasks-100-v1',batch_id:'physician-tasks-100-v1',created_at:new Date().toISOString(),status:'questions_ready',session_count:100,turn_count:queries.length,preset_counts:Object.fromEntries(themes.map(([g,p])=>[p,old.filter(r=>r.agent_preset===p).length])),turn_distribution:old.reduce((a,r)=>(a[r.turns.length]=(a[r.turns.length]??0)+1,a),{}),scenarios_sha256:createHash('sha256').update(content).digest('hex'),completed_sessions:done.size,answered_turns:18,evaluation_status:'not_evaluated',inherited_sessions:[...done]});delete manifest.evaluated_turns;await save(path.join(dest,'manifest.json'),manifest);
await mkdir(path.join(local,'events'),{recursive:true});
for(const id of done){await copyFile(path.join(ROOT,'.local/physician-tasks-50-kb-v1',id+'.json'),path.join(local,id+'.json'));await copyFile(path.join(ROOT,'.local/physician-tasks-50-kb-v1/events',id+'.json'),path.join(local,'events',id+'.json'));}
await writeFile(path.join(dest,'queries.md'),'# 医生场景100组\n\n合成医生任务，不是真实医生日志。已采集的9个会话保持不变。\n\n'+old.map(r=>'## '+r.scenario_id+' · '+r.title+' · '+r.turns.length+'轮\n\n'+r.turns.map(t=>'### 第'+t.index+'轮\n\n'+t.user).join('\n\n')).join('\n\n'));
console.log(JSON.stringify({sessions:100,turns:queries.length,distribution:manifest.turn_distribution}));
