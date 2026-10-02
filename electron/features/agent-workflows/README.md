# Agent 自主分流索引

维护规则：[AGENTS.md](AGENTS.md)。

| 职责 | 实现 |
| --- | --- |
| 技能工具返回的公共会话指引 | `agentTaskGuidance.ts` |
| 技能发现、读取与兼容索引 | [agent-skills](../agent-skills/README.md) |
| Agent 选择流程、外部后续要求的工具 | `agentWorkflowModule.ts` |
| 技能元数据与唯一性 | `electron/mcp/lunaToolModule.ts` |
| 组合注册与 HTTP 指引 | `electron/mcp/lunaAppToolModules.ts`、`lunaMcpServer.ts` |
| 纯文本交接提示词 | `src/lib/assistantAgentPrompt.ts` |

流程：用户描述 → 协调器创建 auto 会话并先存档 → 外部 Agent 通过工具发现技能清单与全文 → 按公共指引领取/核对任务 → 阅读匹配技能全文 → 仅当该技能声明 workflow 且任务需要业务时 `select_task_workflow` → 直接按已读指引执行 → 上报进度/结果。
用户只在输入区选择 Agent，不选择业务功能。Luna 不运行本地关键词分类器。

剪辑还会通过 `list_editing_skills/get_editing_skill` 发现并读取风格、场景 Skill。注册一个新领域指引可自动进入索引，新增执行流程仍需明确服务端契约与准入规则。

外部 Agent 后续沟通通过 `update_task_request` 记录用户要求；所有任务均沿用原 sessionId 继续；每次新要求递增 revision、取消旧导出确认，发现匹配技能后仅在该业务需要时选择流程。

相邻索引：[服务层](../../mcp/README.md)、[任务交接](../external-agents/README.md)、[全局面板](../../../src/components/agent-chat/README.md)。

workflow 是可选准入，不是每项任务的必经步骤。应用级 memory 无 workflow，auto 任务可直接读写；缺失能力不能通过选择无关业务补救。选择 workflow 不会出现新的技能，成功后不重复发现目录。/skill.md 是全应用动态索引，不是剪辑手册。
