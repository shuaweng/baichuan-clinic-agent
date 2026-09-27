# 第三方项目与资料

本仓库包含产品配置、工具适配、评估流程与展示页面，也引用了以下项目和资料。各项内容沿用其自身许可，未统一改授另一种许可。

| 项目或资料 | 用途 | 来源与许可信息 |
| --- | --- | --- |
| DeepSeek Harness | Agent 基座，通过 npm 安装 | [上游仓库](https://github.com/deepseek-ai/deepseek-harness)，许可见上游与安装包 |
| TypeSafe JEV / Vercel AI Gateway | 结构化判断服务 | [TypeSafe](https://typesafe.ai/) / [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)，按服务条款使用 |
| DeepSeek | 回答生成与质量复核 | [DeepSeek API](https://api-docs.deepseek.com/)，按服务条款使用 |
| Haystack | 本地检索流程 | [deepset-ai/haystack](https://github.com/deepset-ai/haystack)，Apache-2.0 |
| WHO PNC / CCC Digital Adaptation Kits | 决策支持表、派生知识片段 | CC BY-NC-SA 3.0 IGO；[PNC 许可](https://smart.who.int/dak-pnc/license.html)、[CCC 许可](https://smart.who.int/dak-ccc/license.html) |
| CDC | 发育筛查、生长、避孕、儿童 mTBI 资料摘录 | [CDC 资料使用说明](https://www.cdc.gov/other/agencymaterials.html)，具体来源见各摘录文件 |
| Chinese-medical-dialogue-data | 早期公开问答评估批次 | [Toyhom/Chinese-medical-dialogue-data](https://github.com/Toyhom/Chinese-medical-dialogue-data)，[随附 MIT 许可](data/chinese-medical-50/SOURCE-LICENSE.txt) |

WHO 派生片段保留原文及定位信息，用于本项目非商业研究演示，遵循原许可的署名、非商业与相同方式共享条件。CDC 摘录保留出处、原文与适用范围。中文标题、切片、检索扩展和展示方式由本项目整理，不代表发布机构的官方译文或认可。详情见 [知识库清单](data/medical-kb/manifest.json)和[资料配置](config/medical-kb/sources.json)。

当前主展示批次 `data/physician-tasks-100` 的问题为设计的医生工作场景，不含真实患者病历。回答与评估来自模型实际调用。早期批次另附来源说明。

品牌名称、标志及用户提供的演示素材归各自权利人所有。此仓库是个人产品实践展示，与相关机构无官方合作或背书关系。API Key、个人诊室档案、本机会话目录未包含在发布内容中。
