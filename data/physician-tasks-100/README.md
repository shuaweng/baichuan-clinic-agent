# 医生场景100组 · 可变轮数

100个独立Session，规划251轮：39个单轮、33个两轮、8个三轮、9个四轮、6个六轮、5个十轮。妇科40组、儿科40组、办公20组。

问题是合成医生工作任务，不是真实医生访谈或病例日志。前50组来自已有研究导向任务集，对尚未采集且可单轮完成的部分任务缩短；已采集9组保持原问题与真实答案。新增50组由DeepSeek按指定主题与长短分布起草，并做结构检查和长对话抽查。长对话含事实更正、后续资料、跨轮核对与交付受众变化；用户发言预先编排，不能据此推算实际医生使用频率。

答案通过本地DeepSeek Harness指定预设实际生成，使用既定模型路由与知识库快照；本目录不含编造的助手答案。已采集9组继承原始session ID和事件证据。具体进度见`collection-status.json`，完整问答见`answers.md`。

## 处理流程

1. `scenarios.jsonl` / `queries.md`：可变轮数用户问题。
2. DSH真实回答 → `sessions.jsonl` / `evaluation-inputs.json`，逐条核对原始事件。
3. JEV14维评价 → `jev-labels.jsonl` / `jev-timeline.json`，成功请求按输入哈希复用。
4. DeepSeek独立复核 → `ds-review.json`，含上游疑点三态结果、原文定位、问题聚类。上游概率和人工笔记不传给复核模型。
5. 产品人工确认另存`.local/physician-tasks-100-v1/ds-review-v1/decisions.json`，不覆盖原始模型结论。

模型医学意见未经过临床专家签核。JEV无问题、复核未发现问题和临床正确是不同状态。DeepSeek复核JEV候选/不确定/缺证据项，并抽查确定性10%的其他QA。页面里“待复核/未抽查”不能解释为通过。

```sh
PHYSICIAN_DATASET=physician-100 python3 scripts/run-physician-dsh-batch.py --execute --workers 3
python3 scripts/run-physician-100-pipeline.py
```

上面两个进程可并行：后者从已完成会话分批导出并验证证据，然后调用JEV和DeepSeek。仅运行已获授权的本地研究批次。失败记录可恢复，不用模拟答案补齐。

看板：`http://127.0.0.1:3081/review?dataset=physician-100&view=board`。

## 长对话输入与失败恢复

JEV 保留当前完整 QA、前文 QA 与实际读取的资料。大输入只去除重复段落副本和检索摘要；原始请求另存，不删减历史回答或已读原文。持续 503 时，把14个独立维度分成最多4题一组，使用相同完整上下文评判。每组请求和响应单独归档，合并结果声明 composition；费用、token、成功耗时和请求次数按实际各组求和。失败调用不会生成标签或被算成 badcase。

可运行 `node scripts/verify-physician-100.mjs` 离线核验全批：会话和问答数量、题目与回答来源、请求哈希、14维完整性、DeepSeek逐字证据、聚类成员覆盖与优先级。
