# JEV + DeepSeek｜用户 Query 洞察与快速打标系统

**从线上用户 Query 中发现需求与 badcase，给产品迭代排出优先级。**

用户每天都在提问。产品团队需要从这些对话中看见：用户真正想做什么，哪些能力没有覆盖，哪些回答出了问题，以及哪些问题值得先解决。

这个项目用 **JEV 快速筛查 + DeepSeek 证据复核与聚类**，把分散的 QA 整理成可追溯、可排序的产品问题与需求看板。以百川妇幼 Agent 为验证场景，已跑通对话采集、结构化打标、复核、聚类和产品回看的完整流程。

[查看产品演示](https://shuaweng.github.io/baichuan-clinic-agent/) · [直接观看录屏](#jev-打标与-deepseek-复核录屏) · [速度与成本口径](docs/速度与成本.md) · [评估结果](data/physician-tasks-100/review-report.md)

## 为什么采用 JEV + DeepSeek

| 优势 | 已验证的表现 | 对产品团队的价值 |
| --- | --- | --- |
| **快：JEV 约 0.3 秒 / QA** | 251 条 QA 的 JEV 上游耗时中位数 **298 ms**，平均 312 ms；每条评价 14 个维度 | 可以把快速筛查放进持续运行的 Query 分析流程 |
| **省：1 万条 QA 约 $7.69** | 按本批实际平均输入量和 $0.04 / 百万输入 tokens 估算，仅计 JEV | 低成本扩大分析覆盖面，持续观察高频问题和新需求 |
| **可调整：规则写在提示词里** | JEV 的判断标准、DeepSeek 的复核要求和聚类粒度均可配置 | 产品团队可以围绕当前迭代目标改规则，再回放历史 QA 验证变化 |

约 0.3 秒指 **JEV 上游处理耗时**。本批成功调用端到端耗时中位数为 683 ms；DeepSeek 复核、排队和重试另计。价格于 2026-09-28 核对自 [Vercel AI Gateway](https://vercel.com/ai-gateway/models/jev)。

### 1 万条的费用怎么算

本批 251 条 QA 共使用 4,826,485 个输入 tokens，平均每条约 19,229 tokens，包含判断规则、当前 QA、可用历史和工具证据。

```text
19,229 tokens / QA × 10,000 QA ÷ 1,000,000 × $0.04 ≈ $7.69
```

这是按同等输入规模计算的 **JEV 筛查成本**，14 维判断已经包含在实际用量里。DeepSeek 复核费用取决于复核比例、上下文长度和模型价格。详细统计及复算命令见[速度与成本](docs/速度与成本.md)。

## 产品经理最终看到什么

| 输出 | 要回答的产品问题 | 下一步 |
| --- | --- | --- |
| **Badcase** | 已支持的任务为什么没做好？事实、医学风险、引证或交付格式哪里出了错？ | 定位原始 QA，调整提示词、工具或知识库 |
| **能力缺口** | 用户的任务是否需要尚未接入的资料、工具或系统？ | 确认能力边界，评估接入方案 |
| **潜在需求** | 多次出现的诉求是否值得新增功能或优化流程？ | 按场景归并，结合频次、影响与用户研究验证需求 |
| **评估问题** | 是回答有问题，还是当前判断规则误报、证据不足？ | 修订评估标准，保留抽查和人工复核 |

每条发现都能回到 Session、Query、回答与原文证据，并附严重程度、工作影响和改进建议。当前医生场景批次产出的是 **22 个回答缺陷簇**；需求与能力缺口作为独立类型保留，避免把所有异常都包装成“新需求”。

## 两阶段打标，把线索变成可处理的问题

```text
用户 Query + Agent 回答 + 会话上下文 + 工具证据
                         ↓
              JEV：逐项判断，输出标签与概率
                         ↓
          疑点 / 不确定项 / 缺证据项 + 未命中抽查
                         ↓
       DeepSeek：核查疑点是否成立，给出原文证据与影响
                         ↓
          按共同问题聚类，按严重程度和覆盖会话排序
                         ↓
         产品经理回看 QA、记录意见、安排优化与回归验证
```

- **JEV 负责快速筛查**：医生场景配置了任务完成、事实忠实、医学陈述、用药与紧急处置、引证、交付物、受众匹配等 14 个维度；代码按标签与概率决定后续处理。
- **DeepSeek 负责复核和整理**：逐项判断疑点有证据支持、不成立或证据不足，给出修改建议，再按共同缺陷归并；证据引文由程序逐字校验。
- **产品经理负责决策**：从问题簇进入具体 QA，确认影响和优先级，把发现落到提示词、知识库、工具或功能的改进上。

### 准确性怎么把关

本批复核得到 **113 项有证据支持的问题发现**，例如原始记录有 5 次出血事件，回答摘要写成了 4 次（D051-turn-1）。看板保留原文对照，能把问题落实到具体片段。

结果可追溯，规则可校准：保留未命中抽查、不确定状态和人工意见。当前尚未建立专家标注金标准，113 项是模型复核结果，不能换算成准确率。上线时可用人工标注集校准误报率、漏报率和复核阈值。[TypeSafe 也明确区分判断置信度与任务正确性](https://docs.typesafe.ai/confidence)。

### 改规则如何落地

| 可调项 | 配置入口 | 例子 |
| --- | --- | --- |
| JEV 判断标准、选项与维度说明 | [14 维规则](config/jev-physician-rubric.v1.json) | 摘要是否补写未提供的事实；引证是否真正支持结论 |
| DeepSeek 的复核依据、严重程度与建议要求 | [复核提示词](config/review/qa-review.md) | 哪类问题需要临床核查；什么证据足以支持疑点 |
| 归并口径与问题簇粒度 | [聚类提示词](config/review/cluster.md) | 按共同缺陷归并，区分回答缺陷、能力缺口与潜在需求 |
| 升级阈值、抽查与排序策略 | [筛查逻辑](runtime/jev/dashboard/shared.mjs)、[复核流程](runtime/review/core.mjs) | 调整筛查覆盖面、复核成本与产品阅读顺序 |

现有维度的规则迭代主要通过提示词完成；新增输出字段时同步调整 schema 和展示。项目保存规则版本与输入指纹，支持断点续跑和结果回放，便于比较修改效果。

## JEV 打标与 DeepSeek 复核录屏

60 秒看完整流程：JEV 逐项打标、DeepSeek 核查证据，再进入产品问题与需求看板。

https://github.com/user-attachments/assets/fd388fe4-357a-49dc-b737-d6c828403429

[在独立页面播放](https://shuaweng.github.io/baichuan-clinic-agent/#evaluation) · [查看仓库中的 MP4](assets/demo/query-review.mp4) · [下载视频](https://raw.githubusercontent.com/shuaweng/baichuan-clinic-agent/main/assets/demo/query-review.mp4)

## 已跑通的验证批次

| 指标 | 医生场景批次 |
| --- | ---: |
| Session | 100，长度为 1–10 轮 |
| 真实模型回答 | 251 轮 |
| JEV 判断 | 3,514 项，14 维 / QA |
| DeepSeek 复核 | 226 条 QA |
| 有证据支持的问题发现 | 113 项，另有 1 项证据待补 |
| 回答缺陷簇 | 22 个 |
| JEV 本批估算费用 | $0.19306 |

问题是设计的医生工作场景，包含 40 组妇科、40 组儿科和 20 组办公任务；回答通过 DSH 实际调用 DeepSeek 生成，打标与复核均为真实调用。

## 面向线上产品的接入思路

作为对话服务之外的分析流程，按日接收新增 Session，保留产品能力范围、当前 QA、必要历史及工具证据，经过脱敏后进入两阶段打标。产品团队在看板中查看高频问题、新需求线索和优先级，再把修复后的 QA 纳入回归集。

**已实现**：批量采集、打标、复核、聚类、人工意见记录与历史回放。**接入生产时补齐**：业务日志适配、脱敏与访问控制、定时调度、人工金标准和线上效果监测。当前仓库提供完整批次脚本，可作为百川妇幼 Agent 场景的接入验证基础。

## 场景适配：用 DSH 搭建妇幼专科 Agent

为验证打标系统在医生场景中的表现，项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **0.1.7-rc.2** 搭建了配套 Agent。复用会话、工具调用、工作区和文件交付能力，生成可评估的真实回答与执行记录。

![妇幼专科 Agent 启动页](assets/images-videos/百川Agent启动页.png)

| 功能 | 实现方式 |
| --- | --- |
| **三个 AgentPreset** | 妇科、儿科、办公分别配置提示词、工具权限与知识范围，覆盖查证、材料整理、沟通稿和办公交付 |
| **我的诊室档案** | 保存科室、医生角色和工作偏好，由医生选择是否带入当前提问 |
| **专科 RAG** | Haystack 本地检索，接入 6 组 WHO / CDC 资料、937 个知识片段 |
| **可追溯引证** | 正文 `[1]` 标注，文末展开来源，保留版本、适用人群和原文定位 |
| **办公文件交付** | 根据任务生成 CSV 等文件，在工作区直接预览与继续修改 |

<details>
<summary>展开查看诊室档案、引证与办公交付截图</summary>

![我的诊室档案](assets/images-videos/百川Agent诊室档案.png)

![儿科回答与引证](assets/images-videos/百川Agent儿科带印证截图.png)

![办公模式交付 CSV](assets/images-videos/百川Agent办公模式csv产物截图.png)

</details>

## 本地体验

需要 **Node.js ≥ 22.18、Python 3.12**。看已有打标结果不需要 API Key。

```sh
git clone https://github.com/shuaweng/baichuan-clinic-agent.git
cd baichuan-clinic-agent
npm ci --prefix runtime/jev
python3 scripts/jev-dashboard.py start
```

打开：

- JEV 打标与回放：<http://127.0.0.1:3081/?dataset=physician-100>
- DeepSeek 逐条复核：<http://127.0.0.1:3081/review?dataset=physician-100&view=review>
- 产品问题与需求：<http://127.0.0.1:3081/review?dataset=physician-100&view=board>

启动医生 Agent 和知识库：

```sh
npm ci --prefix runtime/dsh
python3 -m venv .local/medical-rag-venv
.local/medical-rag-venv/bin/python -m pip install -r runtime/medical-kb/requirements.lock.txt
python3 scripts/dsh-local.py start
python3 scripts/dsh-local.py url
```

用最后一条命令给出的登录地址打开 Agent，在 DSH 设置中配置自己的模型服务与 API Key。仓库已包含知识库索引；如需重建，运行 `.local/medical-rag-venv/bin/python scripts/build-medical-kb.py`。

运行新的 JEV / DeepSeek 评估前，将 `.env.example` 复制为 `.env.local` 并填写自己的密钥。批次流程见[医生任务说明](data/physician-tasks-100/README.md)和[复核模块说明](runtime/review/README.md)。本地服务默认只监听 `127.0.0.1`。

## 看实现

| 内容 | 位置 |
| --- | --- |
| 三个 AgentPreset 与表达风格 | [config/agent-presets](config/agent-presets/) |
| 专科知识库与检索工具 | [runtime/medical-kb](runtime/medical-kb/) |
| JEV 的 14 维判断规则 | [config/jev-physician-rubric.v1.json](config/jev-physician-rubric.v1.json) |
| DeepSeek 复核与聚类提示词 | [config/review](config/review/) |
| 100 个会话与评估结果 | [data/physician-tasks-100](data/physician-tasks-100/) |
| 产品质量看板 | [runtime/jev/dashboard](runtime/jev/dashboard/) |
| 批次流水线 | [scripts/run-physician-100-pipeline.py](scripts/run-physician-100-pipeline.py) |

## 项目与资料

这是一个以 Query 洞察和产品质量迭代为核心、以医生工作流为验证场景的个人产品实践项目。项目使用的品牌素材、DSH、JEV 及模型服务归各自权利人所有。第三方医疗资料保留来源与许可，详见 [THIRD_PARTY.md](THIRD_PARTY.md)。演示页展示产品与已保存的运行结果；在线调用模型请在本地配置自己的服务。

<img src="assets/demo/qr.png" width="180" alt="扫码查看产品演示">
