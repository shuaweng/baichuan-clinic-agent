# 医生工作任务集 v1

50 个 session、100 轮目标 Query：妇科 20 组、儿科 20 组、办公 10 组。

这是依据 [医生 AI 需求调研](../../research/physician-ai-needs-2026-09-23.md) 设计的合成医生任务，未开展医生访谈，不是真实医生日志，也不是 Chinese-medical-dialogue-data 中的原题。配额用于任务覆盖，不代表真实使用频率。

- `queries.md`：逐轮问题与检查要点，可直接审阅。
- `scenarios.jsonl`：机器可读题库，每例绑定相应 AgentPreset；`turns[].user` 是实际要发送的内容。
- `manifest.json`：来源说明、题数、题库与提示词快照哈希。
- `sessions.jsonl`：已采集的真实 DSH 回答，目前为 9 个 session、18 轮。
- `answers.md`：可直接阅读的完整问题和真实回答。
- `evaluation-inputs.json`：每轮 QA、历史、任务检查点、实际工具结果、原文及回答片段定位；实际发送前进一步去重与裁剪，未包含内部推理。
- `collection-verification.json`：与 DSH 原始事件逐条核对后的数量和模型记录。

验收要点用于检查事实忠实、任务完成、来源诚实和使用体验，不是经过医生确认的医学金标准。需要临床判断的任务，还需配置可靠的参考资料并专业复核。当前专科模式已接入有限的 WHO/CDC 本地检索工具，但没有实时联网指南检索或完整药品库；合理说明能力缺口不能直接判成医学 badcase。

两轮设计包含资料补充、数值更正、受众改写和格式约束。全部输入资料内联提供，办公任务无需访问任何真实患者文件。需要用原文核实的题目会明确材料不足，不期待模型编造指南、研究或精确指标。

## 本地验证

默认只验证题库、路由与配置快照；不连接 DSH、不调用模型：

```sh
python3 scripts/run-physician-dsh-batch.py
```

准备开始真实回答采集时，在本地 DSH 已加载新版预设后显式执行。下列命令会调用已配置的模型并产生 API 用量；可按需扩大采集范围：

```sh
python3 scripts/run-physician-dsh-batch.py --execute --limit 3 --workers 1
python3 scripts/run-physician-dsh-batch.py --execute --workers 2
```

每个 session 使用其指定的妇科、儿科或办公预设。只发送问题正文，不把评价要点或禁止错误混入用户 Query。运行复用确定性 session/request ID、保留真实事件及模型路由；已完成项目跳过，未完成项目保留状态以便恢复。

本批独立保存，不覆盖旧患者问答、旧评估标签或看板历史结果。本次已完成 D001、D004、D009、D025、D033、D038、D041、D043、D049，每个预设 3 组。实际模型为 deepseek-flash，18 轮均已核对原始事件；其余 41 组未采集。本次18轮已完成 JEV 试评，252个独立判断、2条问题候选；结果可在看板的“医生场景”批次查看。

## 医生端评价设计

新的任务评价方案见 [医生 QA 评估调研](../../research/physician-qa-evaluation-2026-09-23.md)，规则草案为 `config/jev-physician-rubric.v1.json`。基于该草案冻结的实际请求规则见 `jev-evaluation-contract.json`（physician-qa-1.0-pilot，未校准）；旧患者端标签不代表本批医生任务结果。

本次采集命令：

```sh
python3 scripts/run-physician-dsh-batch.py --execute --ids D001,D004,D009,D025,D033,D038,D041,D043,D049 --workers 3
python3 scripts/export-physician-pilot.py
```

## 本次 JEV 结果

- `jev-labels.jsonl` / `jev-timeline.json`：原始分类、概率及看板历史记录。
- `jev-summary.json` / `jev-report.md`：分类汇总与结果解读。
- `jev-product-review.json`：产品抽查笔记，独立保存，不改写 JEV 标签。
- `.local/physician-tasks-50-kb-v1/jev-results-v1/`：逐条请求、响应和服务失败记录。

```sh
node runtime/jev/evaluate-physician-batch.mjs --dry-run
node --env-file-if-exists=.env.local runtime/jev/evaluate-physician-batch.mjs
```

已成功的请求按输入哈希复用，不重复调用；429/502/503/504 每次运行每条最多尝试三次。统计只含成功请求，网关显示本批 cost 为0，不代表模型长期免费。
