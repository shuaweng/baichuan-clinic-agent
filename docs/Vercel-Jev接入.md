# 通过 Vercel AI Gateway 调用 Jev

当前接入入口：`runtime/jev/evaluate.mjs`，AI SDK 固定为 `ai@7.0.107`。DSH 保持本地运行，评估脚本独立读取已经裁剪、审阅的 state；不需要将 DSH 部署到 Vercel。尚未接入自动会话采集或评估看板。

## 1. 配置 Gateway 密钥

在自己的终端登录 Vercel，并创建 AI Gateway API key：

```sh
vercel login
vercel ai-gateway api-keys create --name baichuan-jev-local
```

已经登录时无需重复 login。若使用团队账号，确认当前团队，或用 `--scope <team-slug>` 明确指定。也可以在 Vercel AI Gateway 控制台创建 key。密钥属于 Vercel AI Gateway，不是 DSH 的对话模型密钥，也不需要另外申请 TypeSafe 直连密钥。

将 key 填入项目根目录 `.env.local`：

```dotenv
AI_GATEWAY_API_KEY=你的网关密钥
```

该文件已被 `.gitignore` 忽略。不要把 key 放进前端变量、会话输入、评估 state 或聊天消息。运行脚本时 Node 会加载该文件；终端已有的同名环境变量优先。

初始化接入时未创建密钥或发送模型请求。真实请求需要所属团队有可用的 Gateway 额度。已有控制台创建的 Gateway Key 时，无需重复运行创建命令。

2026-09-22 联调：环境文件已被正确读取，最小非医疗测试返回 `403 / customer_verification_required`；Vercel 明确要求 Key 所属团队绑定有效信用卡后才能使用网关与免费额度。需要用户在 Vercel 控制台完成账户验证，不是改 Key 名称或重新创建 Key 可以解决的。脚本已为此错误提供明确提示；完整评估尚未成功。

## 2. 预览与运行

在 `/Users/wotar/Desktop/JEV` 执行：

```sh
npm --prefix runtime/jev run preview -- --mode query
npm --prefix runtime/jev run preview -- --mode qa
```

上面两条只生成本地预览，不联网。以下两条会真实调用 Gateway 并使用账户额度。命令块不含注释行，可直接粘贴到默认 zsh：

```sh
npm --prefix runtime/jev run evaluate -- --mode query
npm --prefix runtime/jev run evaluate -- --mode qa
```

默认输入为先前导出的 `.local/jev-preview/turn-1.state.json`，对应“你好，你是谁”那轮真实问答。它是固定样例，不会自动读取后续新会话。指定另一个已经裁剪的 state：

```sh
npm --prefix runtime/jev run evaluate -- --mode qa --input /absolute/path/to/turn.state.json
```

请求预览和结果保存在 `.local/jev-results/`；结果文件包括模型标识、题目版本、答案、概率、用量、网关费用信息（若返回）和输入 hash，不记录请求认证头。模型标识可能只是 Gateway 路由标识，不能据此假定底层 Jev checkpoint 已固定。

输入必须是本项目已审阅的结构化 state，不能传原始 session 文件。该脚本排除若干内部字段并分离 Query 与 QA 视角，但不是通用隐私脱敏器。Query 模式不包含当前 answer 或 execution；QA 模式拒绝没有完整回答或尚未完成的轮次。

首次联调用60秒超时且不自动重试，避免网络错误时不知情地重复请求；超时不代表服务商一定未计费。尚未实现持久化任务去重和自动 token 裁剪。

## 3. 与 TypeSafe 原生接口的区别

| 内容 | 本项目采用的 Vercel AI SDK | TypeSafe 原生接口 |
|---|---|---|
| 调用 | `experimental_evaluate` | `systemOne` / `system_one` |
| 模型 | `typesafe-ai/jev` | 例如 `jev-1.13.0` |
| 是非题 | `type: 'boolean'` | `type: 'noul'` |
| 是非题返回 | `probability` | `noul` |
| Choice/Score | 返回选择/分数与可选概率分布 | 原生格式另有 confidence 等字段 |

不能把 boolean 概率当成一个真正的 JS boolean，也不能假定 AI SDK 暴露原生 confidence。当前代码保留 SDK 实际返回的字段，不自行补造置信度。

新问题放在 `runtime/jev/questions.mjs`，当前为 Query 三题、QA 三题，做最小联调。没有直接复用旧合成数据的能力假设，也未实现完整临床评价或自动新需求确认。

核心调用：

```js
import { experimental_evaluate as evaluate } from 'ai';

const result = await evaluate({
  model: 'typesafe-ai/jev',
  state: preparedState,
  questions: preparedQuestions,
  maxRetries: 0,
  abortSignal: AbortSignal.timeout(60_000),
});
```

## 验证

`npm --prefix runtime/jev test`：使用本地假模型验证真实 AI SDK 的问题与返回结构，不联网、不使用 key；覆盖 Query 隔离、未完成 QA 阻断、内部字段阻断。Query 和 QA 的 dry-run 已在当前真实会话样例上运行。真实 Gateway 连通性、鉴权、费用及评估效果尚未验证。

## 官方文档

- [Evaluation Quickstart](https://vercel.com/docs/ai-gateway/getting-started/evaluation)
- [Evaluation 类型与接口](https://vercel.com/docs/ai-gateway/modalities/evaluation)
- [AI SDK 认证](https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk#authentication)
- [TypeSafe 兼容接口](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)
