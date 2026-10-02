# 外部 Agent 目录索引

维护规范：[AGENTS.md](AGENTS.md)。使用流程：[外部 Agent 操作说明](../../../docs/external-agent-adapters.md)。

| 职责 | 文件 |
| --- | --- |
| 适配器内部契约 | `adapter.ts` |
| 能力与适配器路由 | `externalAgentService.ts` |
| 应用实现 | `workBuddyAdapter.ts`、`codexAdapter.ts` |
| 协议探测与任务链接 | `protocolLauncher.ts`、`taskLinks.ts` |
| 任务创建、保存后交接 | `agentTaskCoordinator.ts` |
| 本地任务历史 | `agentConversationStore.ts` |

新应用：实现适配器与能力声明，在 `electron/ipc/ipcExternalAgentService.ts` 注册；不能改动领域工具或 RPC。
新业务：走 [领域工具模块](../../mcp/README.md)，注册技能后通过 [技能工具](../agent-skills/README.md) 动态发现，由 [Agent 自主选择](../agent-workflows/README.md)。全局任务默认 auto，不新增用户功能选择。

公共 API 见 `src/shared/types/externalAgent.ts`；任务/历史数据见 `agentConversation.ts`，通过 `electron/preloadExternalAgent.ts` 暴露。
IPC 装配见 `electron/ipc/externalAgentConversations.ts`；前端展示见 [全局 AI 助手](../../../src/components/agent-chat/README.md)。
历史路径为 `~/.luna-ai-cut/conversations/conversations.json`；服务地址通过固定发现文件获取，详见 [全应用架构](../../../docs/app-agent-architecture.md)。

路径统一由 [agent-space](../agent-space/README.md) 提供。旧 baseDir 历史仅在新存档不存在时校验后原子复制，旧文件保留；不覆盖新文件或重导入已删除记录。
