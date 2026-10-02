# 导演计划领域规范与索引

继承 [领域扩展规则](../AGENTS.md)。本目录负责计划及素材存储，不负责外部应用启动或剪辑时间线。

| 职责 | 实现 |
| --- | --- |
| Agent 计划格式、校验、创建与修改 | `directorPlanAgentService.ts` |
| 本地计划读取和写入 | `directorLabPlanReader.ts`、`directorLabPlanWriter.ts` |
| 路径与计划存储结构 | `directorLabPlanStorage.ts` |
| 素材导入、复制与下载存储 | `directorLabLocalImport.ts`、`directorLabMediaCopy.ts`、`directorLabDownloadStorage.ts` |
| 删除与清理 | `directorLabPlanDeletion.ts`、`directorLabMaterialDelete.ts`、`directorLabMediaCleanup.ts` |

- Agent 创建遵守 `DIRECTOR_PLAN_FORMAT` 和现有 Markdown 解析器；格式调整同步修改格式查询、解析/校验、实时指引和测试。
- 修改已有计划按 shotId 与 expectedSnapshot 校验，保护素材、范围、标记及原镜头身份；不得用重新导入 Markdown 替代精确编辑。
- 写入保持原子提交、并发保护和幂等行为。调用方不能绕过领域路径及授权范围校验。
- 本地计划编辑不隐式同步手机、不移动或删除素材、不创建剪辑项目。计划到剪辑的绑定仍属待实现流程，不能从架构文档推断已支持。
- Agent 任务使用 `purpose=director-plan`。工具适配当前位于 `electron/mcp/directorPlanTools.ts`，通过应用注册表接入；新业务继续按领域模块规则组织。

工具与服务索引：[本机服务](../../mcp/README.md)。
非界面回归：`scripts/test-director-agent-tools.mjs`、`scripts/test-director-lab-plan-storage.mjs`；涉及素材同步时选择 `scripts/test-director-material-sync.mjs`。
