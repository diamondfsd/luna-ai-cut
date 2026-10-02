# 全应用技能发现规范

先读 [目录索引](README.md)，继承 [领域扩展规则](../AGENTS.md)。

- 全应用技能发现以 `list_agent_skills` 和 `get_agent_skill` 为主；通过公共工具注册层接入 HTTP、MCP 和 OpenAPI，不在 RPC 添加技能或业务名分支。
- 清单从 `LunaToolModule.skills` 实时生成，返回 skillId、moduleId、description 和可选 workflow；查询清单不返回全文。读取工具只接受清单中的精确 skillId，返回当前 instructions。
- 不维护第二份固定技能清单，不按用户关键词选择技能，不要求交接提示词携带某个技能路径。新领域注册技能后应自动被发现和读取。
- 发现与读取是原生只读操作，不启动编辑器、不创建/领取会话、不选择流程、不授予写权限。读取时的未知技能和无效参数须明确报错，不落入 renderer 或直接读任意文件。
- 目录信息和指导文本每次取自当前注册表，避免旧会话/提示词保存过期技能全文。保留现有 skill id 唯一性和安全格式校验。
- 顶层清单包含已注册领域指引；领域文档声明的场景技能和资源继续通过其下级查询工具发现，不宣称顶层清单已聚合所有 renderer 技能。
- Markdown 索引/全文地址只保留兼容，不再作为主交接入口。公共会话规则由 agent-workflows 提供，领域规则由自己的技能全文提供。

回归：`scripts/test-luna-tool-modules.mjs`（原生无副作用、动态模块、全文更新、未知编号、HTTP/MCP/OpenAPI）；`scripts/test-agent-conversations.mjs`（交接不固定技能路径及首次原文保存）。
