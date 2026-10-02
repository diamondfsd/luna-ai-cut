# 外部 Agent 适配器

## 操作入口

唯一入口：导航栏 → AI 助手，右侧展开全局聊天面板 → 选择 Agent 和任务类型 → 输入要求 → 发起任务。
导演计划和 AI 剪辑不再提供独立的助手入口。主窗口切换页面不关闭右侧浮窗，浮窗覆盖页面，不挤压或改变原有布局。导航栏最右侧的带图标「AI 助手」为唯一入口；聊天面板不提供打开或下载应用按钮。
WorkBuddy 或 Codex 打开新任务草稿，用户确认发送后，Agent 读取 Luna 本机 HTTP 服务的最新指引并创建导演计划。
也可复制提示词手动使用。返回 Luna 或关闭弹窗时刷新计划列表。

提示词携带本次要求、任务编号和固定发现文件的位置，不安装外部 Skill，不复制固定版本的完整操作手册。
应用更新后，下一次任务会读取最新服务指引。Luna 必须保持运行，服务地址在每次发起时重新获取。

## 接口与边界

共享契约：`src/shared/types/externalAgent.ts`。
调用入口：`window.luna.externalAgent`，支持 `list/isInstalled/open/download/startTask/copyTask/listConversations/deleteConversation/onHistoryChanged`。
`startTask/copyTask` 接收用户原始要求和任务类型，由主进程创建会话、生成指引、存档，再交给适配器。适配器只负责应用能力，不负责业务流程。
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

## 统一任务面板

`src/components/agent-chat/AgentChatPanel.tsx` 实现右侧非模态面板，复用共享 Radix Dialog 的焦点和关闭行为，不显示遮罩、不拦截页面操作。App 级 Provider 保持状态；`externalAgent.openChat` 保留跨窗口上下文接口，但不新增任何可见入口。
AI 剪辑不再单独生成外部 Agent 提示词弹窗。原生 Bridge 的 `lunaAgent.openChat` 保持 iframe 与宿主的能力边界。
统一读取 Luna 任务服务快照与实时事件，展示用户要求、Agent 进度、结果、错误和取消；支持更新当前任务、停止与导出确认。
先订阅再读取快照，按 sequence 合并并去重，避免初始化期间丢失更新和旧事件覆盖最新状态。面板最多保留 200 个任务事件。
记录范围为 Luna 收到的任务事件，不读取 WorkBuddy/Codex 的全部聊天或推理。首次原始消息、实际交接提示词、进度、结果和错误保存在 `baseDir/agent-conversations/conversations.json`；首次消息在打开外部应用或复制提示词之前保存。支持选择历史、新对话和删除非活动记录。每条任务保留最近 200 个事件，原始消息独立保存，不随事件裁剪丢失；工具参数不进入历史。串行原子写入，损坏历史不会被空内容覆盖。重启后历史可读，旧任务不会自动恢复或被视为仍连接。

多行输入统一使用 `src/ui/Textarea.tsx`，不复用单行 compact 输入的自动宽度；各弹窗铺满可用宽度。

## 稳定服务发现

固定发现文件：`~/.luna-ai-cut/mcp-endpoint.json`，保存最新 `baseUrl` 和进程信息。实际绝对路径由主进程传入提示词，兼容不同系统。文件使用临时文件加原子替换更新；关闭时清除属于当前进程的记录。
Agent 每次新任务、重启或连接失败后重新读文件，校验 `/.well-known/agent`，再读取业务指引。导演计划使用 `/skills/director-plan.md`，剪辑使用 `/skill.md`，不固定端口或扫描端口。
当前未新增 `lunaaicut://` 协议。未来可用于唤醒 Luna；URL 协议本身不能直接向外部 Agent 返回服务地址，仍应使用发现文件。

## 任务隔离

导演计划任务使用 `purpose=director-plan`，不激活剪辑窗口，禁止调用剪辑和音乐工具。剪辑任务使用 `purpose=editing`，保持现有会话、取消和导出确认规则。领取任务必须核对交接提示词中的任务编号；其他活动任务不会被新任务替换。草稿交接成功不代表 Agent 执行成功，后续沟通在所选 Agent 内进行，Luna 面板承接进度和结果。
