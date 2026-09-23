// Post-evaluation product review. These notes never enter JEV state or replace its outputs.
export function attachProductReviewNotes(rows,history){
 const starts={'CMD031-turn-1':'为了能帮您把情况理清楚','CMD037-turn-1':'## 五、请补充','CMD039-turn-1':'## 为了判断更准确'};
 for(const row of rows){
  row.product_review=[];
  const item=history.items.find(i=>i.rowId===row.id),label=item?.modes.qa.result?.answers.followup_burden;
  const start=starts[row.id];if(label?.choice!=='excessive_followup'||!start)continue;
  const offset=row.answer.indexOf(start);if(offset<0)throw new Error('Missing review quote');
  row.product_review.push({dimension:'followup_burden',title:'把一次信息收集改成分步追问',quote:row.answer.slice(offset),check:'按照本项目渐进问询标准核查：多组需回复信息是否给出优先级；必要的紧急风险筛查应保留。',impact:'家长需要一次检索和填写多组信息，可能难以继续作答。这是交互体验候选，不代表这些医学问题不该问。',improvement:'先问最影响下一步的2–3组信息，其余移入可选的就诊准备清单或下一轮；急症提示仍优先展示。',source_ids:[],author:'Codex 对评估结果的产品审阅笔记；未发送给 JEV，也不是模型生成的理由'});
 }
 return rows;
}
