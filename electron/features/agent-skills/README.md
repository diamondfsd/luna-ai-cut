# 全应用技能工具索引

维护规则：[AGENTS.md](AGENTS.md)。

| 职责 | 实现 |
| --- | --- |
| 列出/筛选技能、读取当前全文 | `agentSkillModule.ts` |
| 兼容 Markdown 索引 | `agentSkillIndex.ts` |
| 公共会话操作指引 | `../agent-workflows/agentTaskGuidance.ts` |
| 技能注册元数据与唯一性 | `electron/mcp/lunaToolModule.ts` |
| 应用模块组合与源注入 | `electron/mcp/lunaAppToolModules.ts` |

工具：

- `list_agent_skills({ query?, moduleId?, workflow? })`：默认列出所有注册技能元数据；query 仅筛选文本，不分类需求。返回公共指引 guidance。
- `get_agent_skill({ skillId })`：按实际清单编号读取当前全文 instructions 及同一份元数据。没有匹配编号返回 SKILL_NOT_FOUND。

无需先打开编辑器、领取任务或选择流程。技能全文可声明下级技能/资源查询工具，Agent 按需继续发现和阅读。

新领域：在自己的 `LunaToolModule.skills` 注册内容，自动进入工具清单结果与读取服务，无需改提示词、RPC 或另建技能路径分支。可选 workflow 用于后续权限流程选择，读取本身不授予权限。

交接：固定发现文件 → 服务描述和工具/OpenAPI → 技能清单查询 → 自主选择 → 技能全文 → 按返回指引领取会话并选择允许流程 → 执行。
历史 `/skills/index.md`、`/skills/<id>.md` 和 `/skill.md` 继续兼容，交接不依赖这些路径。

相邻索引：[Agent 执行流程](../agent-workflows/README.md)、[服务层](../../mcp/README.md)、[提示词规则](../../../src/lib/AGENTS.md)。
