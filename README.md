# 医疗 Agent 对话质检与需求发现：第一步

## 2026-09-22：本地 DSH 与妇幼 Agent 准备

已安装固定版本 DSH，提供本地启停脚本和独立的妇幼文本预设。见 [DSH 本地部署](docs/DSH本地部署.md)。模型密钥、医疗知识库、业务工具和 Jev 尚未连接，不能把下方模拟能力配置当作当前运行能力。

```sh
python3 scripts/dsh-local.py start
python3 scripts/dsh-local.py url
```

选型依据与后续接入顺序见 [妇幼资源与工具研究](docs/妇幼Agent资源与工具选型-2026-09-22.md)；可审阅的 [专科提示词](config/maternal-agent/system-prompt.v0.1.md) 与 [业务工具计划](config/maternal-agent/tool-plan.v0.1.json) 已单独存放。以下保留前一阶段成果。

这是面向产品经理面试的独立研究项目，不是百小医官方产品。本阶段交付评估设计与 100 条合成 Query；未调用 Jev，也未生成当前 Answer 或声称发现真实业务 badcase。

## 建议阅读顺序

1. [评估方案](docs/评估方案-v0.1.md)：当前 QA、前五轮上下文、能力/服务边界、好回答与 badcase 的判定。
2. [100 条 Query 审阅稿](docs/100条Query审阅.md)：先看索引，再看各条历史上下文。
3. [产品范围配置](config/product-profile.v0.1.json)：公开能力与未知能力分开；演示政策明确标记。
4. [Jev 问题配置](config/jev-questions.v0.1.json)：Query 层和 QA 层的具体题目与标准。

## 数据

补充对齐材料：[能力边界输入 v0.2](docs/能力边界输入-v0.2.md)，含 17 项详细模拟能力和 [完整请求示例](data/examples/alignment-detailed-qa.request.json)。支持状态均为演示设定；原公开研究配置继续保留未知状态，两者不能混用。

- `data/query-pilot-100.jsonl`：100 条独立场景，全部 synthetic；当前 Answer 留空。
- `data/query-pilot-100.authoring.jsonl`：采样分组与覆盖点，仅供作者审阅，不能传给 Jev。
- `data/pilot-stats.json`：脚本统计的实际分布。
- `data/examples/Q044.query-request.json`：本地组装的请求示例，不是 API 结果。

## 本地命令

仅依赖 Python 3 标准库；不需要 API key，不联网，不产生付费模型调用。

```sh
python3 scripts/build_pilot.py
python3 scripts/validate_pilot.py
python3 scripts/prepare_jev.py --sample Q044 --mode query --out data/examples/Q044.query-request.json
```

注意：`build_pilot.py` 会按脚本中的初始合成内容重建数据和审阅稿，覆盖后续手改的生成文件；后续收集 Answer 请写入新的版本文件，或先备份。此脚本仅用于复现 v0.1。

本阶段的 QA 模式必须因 Answer 缺失而拒绝组装。下一步是审阅样本、细化实际产品能力，然后独立生成当前 Answer 与可控工具结果，再校准判定标准。不要把 null Answer、未知能力或合理追问自动算作 badcase。
