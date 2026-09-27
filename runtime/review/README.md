# DeepSeek 医生 QA 复核

本地看板 `/review?dataset=physician&view=review` 展示逐条复核；`view=board` 展示聚类和阅读优先级。扩容批次为 `dataset=physician-100`。

- 回答仍来自真实 DSH 会话；本环节只评审，不替换答案。
- 首批18轮全量复核。扩容批次选取JEV问题/摇摆/证据不足队列，加确定性10%的未命中抽查。未抽中不代表通过。
- 发送完整当前QA、可用历史、实际工具证据、任务要求及原文。不给DeepSeek看JEV类别概率、人工抽查笔记、回答模型身份或内部推理。
- 每条独立核查14维，并对上游疑点输出有证据支持/不成立/证据不足。证据引用必须逐字匹配给定文本；匹配成功不代表医学语义已验证。
- 聚类只允许给定finding ID，每个恰好归属一组；计数与排序由代码计算。P0/P1优先，随后按证据状态、独立Session数量排序。不是临床签核或自动开发决策。
- 用户确认另存`.local/<batch>/ds-review-v1/decisions.json`，版本历史保存在`human-history/`，不覆盖模型原始结论。

## 服务端密钥

优先读取`DEEPSEEK_API_KEY`，否则仅在服务端提取项目`deepseek env.md`里的唯一`sk-...`密钥。文件已被gitignore排除；密钥只发往固定官方端点`https://api.deepseek.com/chat/completions`。不经浏览器、不写入请求归档。

## 执行

```sh
node --test runtime/review/core.test.mjs runtime/jev/dashboard/review-dom.test.mjs
node runtime/review/run.mjs --dataset physician
node runtime/review/run.mjs --dataset physician-100 --workers 3
```

按prompt+input+model版本哈希断点续跑；旧版本结果归档。模型输出截断、无效JSON、引文校验不通过不会被计为成功。每条最多尝试3次。JSON中的`cost:null`表示官方响应未提供实际账单，不把token数伪装成收费结果。

规则：`config/review/qa-review.md`、`config/review/cluster.md`。
