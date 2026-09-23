## 最新复评 v0.3

同一批 50 条 Q/A 已完成证据与产品体验复评，检出 7 条 badcase 候选（4 条医学证据冲突、4 条事实/体验问题，1 条重叠）。详见 [复评记录](jev-evidence-report.md)。

看板 `?dataset=public-medical` 展示 v0.3，`?dataset=public-medical-v2` 保留旧版。`jev-timeline.json` / `jev-labels.jsonl` 为未改动的 v0.2 归档；新版是 `jev-timeline-v3.json` / `jev-audit-rows.jsonl`。没有专项医学资料的输出不会据此计为证据冲突。

复现：运行 `python3 scripts/prepare-evidence-audit.py` 准备原文片段与来源摘要，再运行 `node --env-file=.env.local runtime/jev/evaluate-evidence-batch.mjs`。缓存按精确请求指纹复用；若输入或规则变化，不应续跑旧任务，应另建版本。

# 公开妇幼问题 · 50 个 DSH Session

问题与配对参考答案来自 [Toyhom/Chinese-medical-dialogue-data](https://github.com/Toyhom/Chinese-medical-dialogue-data)，固定提交 `26724a4357fcd142f0cab81188cacf1a2dd8a827`。原仓库 MIT 许可保存在 `SOURCE-LICENSE.txt`。

- 妇产科 25 条、儿科 25 条，10 个主题各 5 条。按固定随机种子及关键词抽样，去除近似重复、联系方式和明显拼接/截断问题；定向排除记录见 `selection-exclusions.json`。不是随机临床流量样本。
- 每条原始问题形成一个独立单轮 Session，共 50 条 QA。只去除首尾空白，不改写错别字、不生成追问。原仓库未提供逐条原站或原始就诊记录，未独立验证真实患者来源。
- DSH 只接收问题。妇科/儿科分别使用 `baichuan-gynecology` / `baichuan-pediatrics` 预设，由已配置的 DeepSeek 实际生成答案；未注入参考答案，未改写模型回答。
- 原数据集配对答案仅在 JEV 回答评估时加入，保留原文、提交号、CSV 记录序号/物理行号、文件和记录 SHA-256。参考未经临床审核，可能存在错误和过时内容，不是金标准。

## 评估

版本 `medical-reference-0.2`，每条 QA 两次请求，12 个判断：

- 诉求：服务范围、能力覆盖、明确不满。
- 回答：医学正确性、用药安全、处置与分诊风险、参考答案对照、回答覆盖、事实与要求遵守、建议可执行性、沟通体验、信息负担。

JEV 只给出分类及概率。badcase 候选由代码汇总疑似医学错误、用药或处置风险、明确的体验缺陷以及漏答/答非所问；与参考冲突本身不自动认定错误。参考不足、材料不足、分布摇摆均保留独立队列。未发现问题不表示已证明医学正确，模型概率也不等于医学准确率。本批未做医生复核，不能据此计算医学评估准确率或召回率。

`jev-labels.jsonl` 保存 Q、DSH A、参考与来源，`jev-timeline.json` 保存 JEV 原始分类与调用数据；`jev-summary.json` 汇总候选数量。历史合成批次独立保存在 `data/session-batch-50`，不覆盖。

## 复现

```sh
python3 scripts/prepare-public-medical-batch.py
python3 scripts/run-public-dsh-batch.py
python3 scripts/export-public-dsh-batch.py
node --env-file-if-exists=.env.local runtime/jev/evaluate-public-batch.mjs
```

抽样脚本依赖 `.local/chinese-medical-source` 中固定提交的原始 CSV（GB18030）；下载完整文件不提交 Git。生成脚本使用本地 DSH 的认证 RPC，并对已完成记录跳过。JEV 请求和结果保存于 `.local/chinese-medical-50-20260923/jev-results-v2`，断点恢复通过输入指纹和已完成记录避免覆盖结果。原始模型推理及认证信息不进入看板、参考材料或 JEV 输入。
