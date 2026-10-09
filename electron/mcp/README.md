# 本机 Agent 服务

MCP/HTTP 服务通过组合注册表暴露原生应用能力与动态技能；没有 renderer 动态工具桥接。

| 职责 | 实现 |
| --- | --- |
| HTTP、服务发现与生命周期 | `lunaMcpServer.ts` |
| MCP 请求与模块策略 | `lunaMcpRpc.ts`、`lunaMcpProtocol.ts` |
| 工具契约和组合注册 | `lunaToolModule.ts`、`lunaAppToolModules.ts` |
| 工具目录/OpenAPI | `lunaMcpCatalog.ts` |
| 会话、revision、取消和结果 | `agentSessionManager.ts`、`agentSessionState.ts` |
| 技能查询与读取 | `electron/features/agent-skills/` |
| 工作流选择 | `electron/features/agent-workflows/` |
| 拍摄计划 | `directorPlanTools.ts` → director-lab service |
| 素材标注和剪辑工程 | `electron/features/ai-editor/aiEditingToolModule.ts` |
| 应用级记忆 | `electron/features/memory/` |

新工具放在所属领域目录声明 schema、执行器和 `allowedPurposes`，再由 `lunaAppToolModules.ts` 注册。任务写入同时验证活动 session、request revision 与领域数据 revision。技能正文只描述注册表中真实可用的能力。
