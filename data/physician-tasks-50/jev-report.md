# 医生场景 JEV 评估结果

18/18 条真实 DSH QA，252 个判断；2 条问题候选。费用：$0.000000。

问题为医生任务合成场景；答案来自实际 DSH。候选按独立维度的模型分类汇总，未做临床专家确认或阈值校准；证据不足不计作通过。JEV 不生成文字理由。

| QA | JEV 问题候选维度 |
|---|---|
| D033-turn-2 | 引文支持关系 48% |
| D043-turn-2 | 受众匹配 53% |

## 各维度分布

- 任务完成：{"completed":18}
- 病例事实忠实：{"no_issue_detected":14,"not_applicable":4}
- 医学陈述正确性：{"no_issue_detected":9,"not_applicable":9}
- 临床思路帮助：{"not_applicable":15,"no_issue_detected":3}
- 关键事项遗漏：{"no_issue_detected":10,"not_applicable":8}
- 用药风险：{"not_applicable":17,"no_issue_detected":1}
- 紧急处置风险：{"not_applicable":15,"no_issue_detected":3}
- 引文支持关系：{"not_applicable":15,"supported":2,"partial_support":1}
- 证据适用性：{"no_issue_detected":7,"not_applicable":11}
- 不确定性处理：{"no_issue_detected":18}
- 交付物可用性：{"usable_draft":17,"minor_edit":1}
- 受众匹配：{"no_issue_detected":17,"issue_detected":1}
- 工具与执行真实性：{"no_claim":12,"supported":6}
- 信息使用边界：{"not_applicable":17,"no_issue_detected":1}

原始请求和响应：`.local/physician-tasks-50-kb-v1/jev-results-v1/`；当前与历史工具证据均保留，内部推理未发送。

## 产品抽查（非 JEV 输出）

### D001-turn-1

**疑似漏检：补出了未提供的年份。**

原问题只有“3月12日记录近3个月经期延长”，没有给出年份。回答却写“据此推算症状约起自2024年12月中旬”。相对月份不能推出 2024 年；复诊摘要应保留未知年份。

这是产品抽查发现的事实忠实问题候选。JEV 的病例事实忠实分类为“未发现具体问题”，原始结果未修改。

### D033-turn-2

**JEV 引文支持关系：仅部分支持，48%；另一主要选项“不相关”为28%。**

定位：回答片段 D033-turn-2-p19，引用 CDC 关于发育监测与标准化筛查的原文；实际读取来源为 cdc-development-16db124aca。

回答已明确写“CDC 该页面面向美国0–5岁儿童保健，对7岁儿童适用性有限”。因此不能仅凭年龄差就认定误用，需核对这条引文到底支持哪一句话。此笔记是产品复核定位，不是 JEV 生成的理由，也没有确认医学错误。

### D043-turn-2

**JEV 受众匹配：发现问题线索，53%；未发现问题为46%。**

用户要“80字以内的客观说明”。回答给出一段月报文字后，又追加“两点使用提示”和继续改写的询问。产品复核可关注交付段落是否方便直接复制、附加说明是否必要，但这些内容未必构成受众不匹配。

上文是产品复核方向，不是 JEV 输出的原因；保留原始分类及完整概率，不将其写成已确认 badcase。
