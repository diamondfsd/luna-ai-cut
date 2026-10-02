# Agent 功能的 IPC 接入规范

本文件仅补充 Agent 相关 IPC 的维护边界；其他功能继续遵守根目录及所属领域规则。

| 当前接入 | 实现 |
| --- | --- |
| 外部应用能力及注册 | `ipcExternalAgentService.ts` |
| 任务交接、历史和变更通知 | `externalAgentConversations.ts` |
| 当前会话及活动事件 | `ipcAiEditorAgentService.ts` |
| 本机 Agent 服务连接 | `ipcAiEditorMcpService.ts` |

- IPC 负责参数入口、服务装配和通知；领域业务在所属服务实现，不能在 handler 内复制工具执行策略。
- 新增公共接口同步检查 `src/shared/types`、preload、handler、调用方和相关契约测试。渲染层不可传入任意启动命令、下载地址或可信文件路径。
- `ipc*.ts` 由主进程自动注册；`externalAgentConversations.ts` 由外部 Agent service 显式装配，不能重复注册。新 helper 不要误用自动注册文件名。
- 历史读取/删除遵守串行存储与活动任务保护；事件写入完成后通知，退出前等待已排队保存结束。
- 导演计划任务不能通过窗口激活通知进入 AI 剪辑页；保留任务类型隔离。
- iframe 原生能力继续走父窗口 preload/IPC/bridge，不直接引入 Node 或 Electron，也不复用工作台项目目录。

相邻规范：[外部 Agent](../features/external-agents/README.md)、[本机服务](../mcp/README.md)、[共享契约](../../src/shared/types/AGENTS.md)。
