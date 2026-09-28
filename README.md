# JEV + DeepSeek｜从用户 Query 中发现需求与 badcase

**用户每天都在提问，产品下一步该改什么，答案就藏在这些对话里。**

有人反复追问，有人换一种说法重试，有人的问题得到了流畅却错误的回答。逐条翻聊天记录太慢，看调用量和满意度又很难找到具体原因。

这套系统把这些对话接起来：**JEV 快速找线索，DeepSeek 核对证据、归并问题，产品经理直接看哪些值得改、为什么、先改哪个。**

在妇幼医生场景中，100 个会话、251 轮真实模型回答，已经整理出 **22 类回答问题**。JEV 单条 QA 上游处理约 **0.3 秒**，同等输入规模下，**1 万条 QA 的 JEV 筛查费用估算约 $7.69**。

[看完整演示](https://shuaweng.github.io/baichuan-clinic-agent/) · [看打标录屏](#一分钟看完整流程) · [本地体验](#本地体验)

## 快到能常用，便宜到能多看，规则由业务来定

**约 0.3 秒，给一条 QA 做 14 个维度的判断。** 从任务有没有完成，到有没有编造事实、引用是否对得上、交付物能不能用，JEV 一起给出标签和概率。产品团队可以持续观察每天的对话，及时发现问题。

**1 万条 QA，JEV 筛查约 $7.69。** 按这批对话的实际输入量估算，问答、上下文、判断规则和工具证据都已计入。低成本让团队有条件扩大覆盖面，既看高频问题，也关注分散的新诉求。DeepSeek 的复核与聚类按实际调用另外计费。

**产品关注点变了，改提示词就能调整判断标准。** 这周关注摘要里的事实偏差，下周关注引用质量或交付格式：JEV 的判断要求、DeepSeek 的复核尺度和归并方式都可以调整，再用历史 QA 检查新规则。

<sub>速度取本批 251 条 QA 的 JEV 上游耗时中位数 298 ms；万条费用按同等平均输入量与 $0.04 / 百万输入 tokens 估算。[查看计算方式与完整口径](docs/速度与成本.md)</sub>

## 先把值得看的对话找出来

左边是用户问了什么、Agent 答了什么，右边是逐项判断。点一下类别，就能找到对应的 QA，继续回看完整会话。

模型有没有答非所问？关键事实有没有遗漏？这件事需要接一个新工具，还是把已有能力做好？系统把这些线索整理出来，帮助产品经理找到值得深挖的地方。

![JEV 打标：QA 明细、14 维判断和分类分布](assets/images-videos/百川JEV打标截图.png)

## 再把“看着不对”说清楚

**哪里有问题、证据在哪、会影响什么，放在一起看。** DeepSeek 复核 JEV 筛出的疑点，把用户原文和回答片段对照起来，给出判断与修改建议。产品经理可以沿着证据核查，也可以直接记录自己的处理意见。

下面这条就很具体：用户的记录里有 **5 次出血事件**，Agent 的摘要写成了 **4 次**。复核定位到了这句回答，并建议核对摘要计数与原始记录。这样的发现，可以直接转成一个优化任务。

![DeepSeek 复核：原文、回答片段、问题说明与修改建议](assets/images-videos/百川AgentDeepSeek复核截图.png)

## 最后，告诉产品经理先看哪几个

同一种问题可能出现在几十段对话里。看板把它们归到一起，显示涉及多少个会话、影响是什么、建议怎么改，再按严重程度排好顺序。点击任何一组，都能回到具体案例。

**回答缺陷、能力缺口、潜在需求分开整理。** 已有能力没做好，就查原因；用户反复要求的新能力，就收集场景和证据，进入需求讨论。

这批医生场景经过模型复核，得到 **113 项有证据支持的发现**，归并后的看板共有 **22 类回答问题**，包括事实补写、计数错误、关键事项遗漏和引证问题。产品团队可以据此安排提示词、知识库与工具的改进。

![产品问题与需求：按优先级查看问题组和关联 QA](assets/images-videos/百川Agent产品需求聚合截图.png)

<sub>本批使用设计的医生工作场景；回答由 DSH 实际调用 DeepSeek 生成，打标与复核均为真实模型调用。[查看案例与评估记录](data/physician-tasks-100/review-report.md)</sub>

## 一分钟看完整流程

从 JEV 打标，到 DeepSeek 复核，再到产品问题与需求看板。

https://github.com/user-attachments/assets/fd388fe4-357a-49dc-b737-d6c828403429

[独立页面播放](https://shuaweng.github.io/baichuan-clinic-agent/#evaluation) · [仓库中的 MP4](assets/demo/query-review.mp4) · [下载录屏](https://raw.githubusercontent.com/shuaweng/baichuan-clinic-agent/main/assets/demo/query-review.mp4)

## 放进医生的工作里，看看它能发现什么

为了适配百川妇幼 Agent 场景，我们用 **DSH 搭建了一套医生工作助手**，让它实际完成任务，产生回答和工具记录，再交给打标系统分析。

### 妇科、儿科、办公，按任务切换

基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 复用会话、工具调用、工作区与文件交付能力，快速搭建产品。三个 AgentPreset 分别配置提示词、工具权限和知识范围：整理病程、查证资料、起草沟通内容、处理办公文件，各有对应的能力。

![百川妇幼专科 Agent：妇科、儿科与办公模式](assets/images-videos/百川Agent启动页.png)

### 记住诊室背景，少问一遍基础信息

「我的诊室档案」保存科室、医生角色、常见任务和工作偏好。医生选择是否带入当前提问，让回答更贴合自己的工作。

![我的诊室档案](assets/images-videos/百川Agent诊室档案.png)

### 给出回答，也给出出处

基于 Haystack 的专科 RAG 接入了 **6 组 WHO / CDC 资料、937 个知识片段**。正文用 `[1]` 标出引用，文末展开来源，医生可以查看原文、版本和适用人群。

![儿科回答与可展开的引用来源](assets/images-videos/百川Agent儿科带印证截图.png)

### 办公任务，直接交付能用的文件

给出排班要求，Agent 整理成 CSV。结果留在工作区，随时预览、继续修改。

![办公模式：排班 CSV 生成与文件预览](assets/images-videos/百川Agent办公模式csv产物截图.png)

## 接到线上产品，持续听见用户的需求

这套方案适合接在对话服务之后：按日收集新增 Query 和回答，带上必要的上下文与工具证据，经过打标、复核和聚类，形成当天值得关注的问题清单。

团队可以沿用现有 Agent，把自己的业务规则写进提示词。批量处理、断点续跑、结果回放和人工意见记录已有对应实现；业务日志、调度和数据权限按部署环境接入。

**让用户每天的问题，成为产品每天进步的线索。**

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

## 代码与规则

[看 JEV 判断规则](config/jev-physician-rubric.v1.json) · [看 DeepSeek 复核与聚类提示词](config/review/) · [看产品看板实现](runtime/jev/dashboard/) · [看 AgentPreset](config/agent-presets/) · [看批次流水线](scripts/run-physician-100-pipeline.py)

[速度与成本](docs/速度与成本.md) · [评估结果](data/physician-tasks-100/review-report.md) · [第三方项目与资料](THIRD_PARTY.md)

个人产品实践项目，项目与资料归属见上方说明。

<img src="assets/demo/qr.png" width="180" alt="扫码查看产品演示">
