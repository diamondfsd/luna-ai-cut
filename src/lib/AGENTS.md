# Agent 提示词维护

本文件仅约束 Agent 提示词模块，不扩大到本目录其他工具函数。

| 模块 | 职责 |
| --- | --- |
| `assistantAgentPrompt.ts` | 通用交接、技能自主选择与只读历史沟通规则 |
| `agentDiscoveryPrompt.ts` | 稳定发现文件、最新地址与连接失败处理 |
| `directorPlanAgentPrompt.ts` | 导演计划交接要求 |
| `aiEditorAgentPrompt.ts` | 剪辑交接要求及历史 stdio 提示词 |

- 提示词为纯函数，允许主进程复用，不依赖页面、React、Electron 或浏览器副作用。`src/pages/aiEditorAgentPrompt.ts` 只保留兼容导出。
- 业务操作手册由运行中服务的技能工具提供最新版本。交接提示词只负责服务与工具发现，不指定技能路径、编号、领域选择规则，不复制固定 Skill 或安装依赖。
- Agent 新任务、应用重启和连接失败时重新读取发现文件。当前地址只作本次参考；不得扫描端口或修改发现文件。
- HTTP 交接通过服务返回的 tools/OpenAPI 发现技能查询工具。Agent 使用 list_agent_skills 读清单、get_agent_skill 读全文，按返回的 description/workflow/公共指引执行；这些技能选择信息只能由服务返回，不写入提示词条件分支。专用 HTTP 函数名只保留兼容导出，复用同一通用提示词。提示词不能替代权限、参数和 revision 校验。
- 新领域通过工具模块的 skills 注册提供最新指引；新增执行流程显式接入会话、共享类型和 agent-workflows，不新增面板功能选项。不要在应用适配器内生成业务提示词。

相邻规范：[任务协调器](../../electron/features/external-agents/README.md)、[服务与实时指引](../../electron/mcp/README.md)。
