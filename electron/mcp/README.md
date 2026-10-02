# 全应用本机 Agent 服务索引

修改本目录先读 [AGENTS.md](AGENTS.md)。这里是协议与应用能力的组合层，业务服务位于各自领域目录。

| 职责 | 当前实现 | 扩展规则 |
| --- | --- | --- |
| HTTP 与发现文件生命周期 | `lunaMcpServer.ts` | 提供统一服务入口，保持原子更新和清理 |
| MCP 协议与公共响应 | `lunaMcpRpc.ts`、`lunaMcpProtocol.ts` | 不增加领域工具判断 |
| 模块契约与注册表 | `lunaToolModule.ts` | schema、执行器、模块策略统一声明 |
| 应用组合入口 | `lunaAppToolModules.ts` | 注册新领域模块 |
| 工具清单与 OpenAPI | `lunaMcpCatalog.ts` | 从注册表派生 |
| 当前任务会话 | `agentSessionManager.ts`、`agentSessionState.ts` | revision、领取、取消、导出确认 |
| 全应用技能查询与全文 | `../features/agent-skills/` | 注册信息动态生成，不固定提示词路径 |
| Agent 自主选择与技能索引 | `../features/agent-workflows/` | 由 Agent 根据 description 选择，不让用户选功能 |
| 任务工具 | `lunaMcpTaskCatalog.ts`、`lunaMcpTaskTools.ts` | 当前包含历史音乐工具实现；新领域不要继续堆入 |
| 原生导演计划工具 | `directorPlanTools.ts` | 调用导演领域服务，未来新增领域工具放回领域目录 |
| 剪辑桥接兼容层 | `lunaEditorToolModule.ts` | 仅动态 iframe 工具 |
| 应用级记忆 | `../features/memory/` | 无 workflow，不依赖编辑器，通用模块注册 |
| 个人持久空间 | `../features/agent-space/` | ~/.luna-ai-cut，与安装/项目/缓存独立 |
| 外部 Agent 实时指引 | `lunaHttpSkill.ts`、`directorPlanHttpSkill.ts` | 按业务任务提供最新流程 |

新增工具：领域服务 → 领域 `LunaToolModule` → 组合入口 → 自动发现与调用。
领域技能注册在模块 skills 中，自动进入 list_agent_skills/get_agent_skill 的查询与读取结果。新增执行流程还需调整公共契约、会话、agent-workflows 和指引；不增加聊天功能下拉。

相邻目录：[领域规范](../features/AGENTS.md)、[外部 Agent 与历史](../features/external-agents/README.md)、[全局面板](../../src/components/agent-chat/README.md)、[IPC 接入](../ipc/AGENTS.md)。
完整分层与现有限制见 [架构文档](../../docs/app-agent-architecture.md)。

任务可持续续聊：`agentSessionArchive.ts` 维护任务查找与延续校验；`update_task_request` 用原编号开启新执行版本。完成、失败和停止不代表任务永久结束。持久化读取由 external-agents 注入。

全局 /skill.md 返回实时应用索引及公共指引。业务手册只经技能全文/兼容业务端点读取。未打开剪辑窗口时主进程桥接立即返回不可用，不向主库窗口发送无人处理的编辑请求。
