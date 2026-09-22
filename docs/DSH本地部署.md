# DSH 本地部署

安装版本：`@deepseek-ai/dsh@0.1.5-rc.2`。安装时 npm `latest` 返回该版本；GitHub master 文档可能领先于发布包，配置以实际安装包为准。完整依赖锁定在 `runtime/dsh/package-lock.json`。未进行全局安装。

## 启停与访问

在 `/Users/wotar/Desktop/JEV` 执行：

```sh
python3 scripts/dsh-local.py start
python3 scripts/dsh-local.py status
python3 scripts/dsh-local.py url
python3 scripts/dsh-local.py stop
```

服务只监听 `127.0.0.1:3080`，不会注册开机启动。`start` 将服务作为独立后台进程启动。`status` 会完成 DSH 自带的令牌/会话 cookie 交换再检查首页，认证检查不会调用模型。`stop` 只对 PID 文件指向且命令行匹配本项目的 DSH 发送 SIGTERM。

首次打开需要使用 `url` 输出的完整本地登录链接。直接打开 `http://127.0.0.1:3080/` 且没有有效 cookie 时，401 是正常认证保护，不代表服务宕机。登录链接是本地凭据，不要分享到报告或提交版本库。每次重启需要获取新链接。浏览器地址栏建议直接粘贴完整链接。

如果从 Codex 沙箱执行启停，监听端口或查询进程可能需要工具的本地执行权限；不需要调整系统防火墙或关闭认证。

## 配置模型与工作区

1. 打开上述认证链接，在 Settings → Models 中配置你选择的模型服务及 API key。不要把 key 发到聊天或写进公开文件。
2. 选择独立工作区 `/Users/wotar/Desktop/JEV/.local/dsh-workspace`。
3. 新会话默认使用“妇幼专科模式”，覆盖女性全生命周期、0–18岁儿童青少年及生殖健康与筛查。原始 DSH 编码预设仍保留，不能把它当成患者端预设。
4. 当前妇幼预设仅有专科对话提示词，没有挂载 shell、文件读写或医疗 MCP。工具集与知识库是后续接入工作。提示词没有经过模型调用或医学效果验证。

专科预设的名称、描述和 persona 由 `config/maternal-agent/` 管理，每次启动自动同步；请在源文件修改这些内容。同步保留预设中的其他插件和额外元数据。首次升级前的旧配置备份在 `.local/backups/maternal-preset-before-lifecycle-update/`。内部 id 保留 `maternal-preview` 以兼容历史会话，不是用户可见的名称。提示词更新后应开启新会话检查，已有会话可能继续沿用已挂载的配置。

本次未配置模型密钥，也未调用回答模型或 Jev。配置模型后才可生成真实 Answer 和 Session 执行结果。

## 文件位置

| 对象 | 位置 |
|---|---|
| npm 安装与锁文件 | `runtime/dsh/` |
| DSH 独立 home（含后续凭据、会话、设置） | `.local/dsh-home/` |
| 独立测试工作区 | `.local/dsh-workspace/` |
| 输出日志 | `.local/logs/dsh.log` |
| 进程 PID | `.local/dsh.pid` |
| 专科运行预设 | `.local/dsh-home/.agent-presets/maternal-preview/` |
| 可审阅提示词 | `config/maternal-agent/system-prompt.v0.1.md` |
| 预设名称与描述 | `config/maternal-agent/preset.json` |
| 拟议业务工具 | `config/maternal-agent/tool-plan.v0.1.json` |
| 本地部署覆盖配置 | `config/dsh-local.patch.yml` |

`.local/` 已加入 `.gitignore`。专科预设未启用原生编码工具；独立目录本身不是操作系统级容器隔离。不要在默认编码预设中放入真实患者数据。

本地覆盖配置关闭遥测，并明确不上传附加的 Session 日志字段。普通模型 API 调用仍会发送模型所需上下文，不能由此声称所有对话都离线运行。启动脚本避免继承其他应用的常见 API key/token 环境变量；该部署的密钥在本地 UI 中单独配置。

## 重装

安装相同依赖（需要网络）：

```sh
npm ci --prefix runtime/dsh --cache /private/tmp/jev-npm-cache --no-audit --no-fund
```

不要随意改为 `latest`。升级时记录版本、检查 preset/MCP 兼容性，并重新验证会话日志格式。

## 参考

- [官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [模型配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md)
- [资源与工具选型](妇幼Agent资源与工具选型-2026-09-22.md)
- [国家卫健委：妇幼健康服务机构标准化建设与规范化管理指导意见](https://www.nhc.gov.cn/fys/c100078/201512/dd9f9bd5af084dbc9abf5bb9cadbab7d.shtml)：妇幼健康服务包含孕产保健、儿童保健、妇女保健和计划生育技术服务。本项目根据用户确定的产品范围，组织为妇女保健与妇产科、儿童保健与儿科、生殖健康与筛查三类服务；该资料用于服务范围参考，不是具体临床处置规则。

注意：当前安装包的 `dsh-session-log-deepseek` 文档默认 `enabled: false`，而抓取到的 GitHub master SDK 指南仍写了默认上传；本部署使用显式 `false`，以可检查配置消除版本差异。
