# 外部 Agent 适配器

## 操作入口

实验室 → 导演计划，选择 Agent → AI 创建 → 输入计划要求 → 发起任务。
WorkBuddy 或 Codex 打开新任务草稿，用户确认发送后，Agent 读取 Luna 本机 HTTP 服务的最新指引并创建导演计划。
也可复制提示词手动使用。返回 Luna 或关闭弹窗时刷新计划列表。

提示词只携带本次要求和运行中的 `skillUrl`，不安装外部 Skill，不复制固定版本的完整操作手册。
应用更新后，下一次任务会读取最新服务指引。Luna 必须保持运行，服务地址在每次发起时重新获取。

## 接口与边界

共享契约：`src/shared/types/externalAgent.ts`。
调用入口：`window.luna.externalAgent`，支持 `list/isInstalled/open/download/startTask`。
未来的可选 `installSkill` 能力保留，但当前流程不使用。

适配器在 `electron/features/external-agents/` 中实现，在 `ipcExternalAgentService.ts` 的固定注册表注册。
每个适配器独立声明打开、下载、技能安装和任务启动能力。渲染层不能指定应用启动命令或下载地址。
`task` 能力：`draft` 预填任务草稿；`clipboard` 打开并复制提示词；`unsupported` 不支持。
发起成功仅表示操作系统接受链接，不代表 Agent 已发送、执行或完成任务。结果应由 Luna 的任务报告工具确认。

- WorkBuddy：通过 `workbuddy://` 查询系统协议注册；未注册时常见安装目录检测作为兜底，任务退回打开并复制提示词。
  任务链接 `workbuddy://task?action=start&prompt=<encoded>`。默认草稿，不自动发送。
  提示词超过 8000 字符时拒绝发起，保留复制入口，避免 WorkBuddy 静默截断。
  下载使用指定个人邀请链接。
- Codex：通过 `codex://` 检测和打开，不提供下载。
  任务链接 `codex://threads/new?prompt=<encoded>`。默认预填，不自动发送。
  本机 ChatGPT.app 注册该协议；注册应用名称可能随产品版本不同。

## 调研依据和验证范围

WorkBuddy 5.5.6 本机应用包：renderer 中的 task deeplink 解析器及草稿协调器。
Codex/ChatGPT 本机应用包：主进程 deep link parser 的 `threads/new` 分支及 `newThread` 的 `prefillPrompt` 处理。
官方文档 https://developers.openai.com/codex/app/features/ 未确认上述 URL 作为公开稳定契约；当前实现依据本机版本代码。
没有进行真实应用界面验收或发送任务。旧版本支持情况和系统链接长度限制需要在明确授权的后续验收中确认。
