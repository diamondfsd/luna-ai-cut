# 应用级记忆索引

维护前先读 [AGENTS.md](AGENTS.md)。完整设计见 [应用级记忆架构](../../../docs/app-memory-architecture.md)。

| 职责 | 文件 |
| --- | --- |
| 通用记录、来源、范围、版本和访问上下文 | `memoryTypes.ts` |
| 串行读取、格式校验和原子提交 | `memoryRepository.ts` |
| 检索、保存/更正、来源校验、幂等与忘记 | `memoryService.ts` |
| 应用工具 schema、任务访问适配和技能注册 | `memoryToolModule.ts` |
| 外部 Agent 的应用级记忆指引 | `memorySkill.ts` |

通过 `createMemoryToolModule(service)` 注册到本机服务 `toolModules`。`list_agent_skills` 动态发现 `memory`，此技能不声明 workflow。任务可保持 auto；不依赖剪辑窗口、导演计划、外部应用或 renderer。服务与仓储不导入 Agent 会话，由工具适配器提供校验回调。

持久化：`~/.luna-ai-cut/memory/memories.json`，路径仅由 [个人空间](../agent-space/README.md) 提供。不放在项目目录、缓存、安装目录或 Electron userData，不随卸载/项目删除/切换 baseDir 自动清理。

已实现工具：`search_memories`、`get_memory`、`save_memory`（新建和更正）、`forget_memory`。HTTP、MCP、OpenAPI 由公共注册表生成，不维护额外清单。

当前可靠来源是服务保存的任务要求；外部后续原话仍标记 task-request，不冒充已读取第三方聊天。逐字内容为 recorded，Agent 改写和分析为 candidate；都不等于用户批准某项偏好。媒体指纹/证据范围、计划上下文和自动提取仍是后续扩展，不可声称已实现。

回归：`node --experimental-strip-types scripts/test-app-memory.mjs`。服务/技能公共契约还需选择 `scripts/test-luna-tool-modules.mjs`、`scripts/test-luna-mcp-agent-contract.mjs`。不构建、不启动 UI。
