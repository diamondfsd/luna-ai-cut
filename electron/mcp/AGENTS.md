# 本机 Agent 服务规范

适用于本目录。继承根目录规则；本目录虽然沿用 `mcp` 名称，但服务面向整个 APP，不只服务 AI 剪辑。

先读 [目录索引](README.md)，跨层设计见 [全应用架构](../../docs/app-agent-architecture.md)。

## 必须保持的边界

- `lunaMcpRpc.ts` 只处理协议解析、通用策略、路由和响应封装。禁止增加按业务工具名、外部 Agent 名称或任务类型硬编码的分支。
- 新领域工具在所属 `electron/features/<domain>/` 声明 schema、执行器和领域策略，通过 `LunaToolModule` 注册；应用组合入口为 `lunaAppToolModules.ts`，也可用 `LunaMcpServerOptions.toolModules` 注入。
- 领域指引通过模块 skills 注册；list_agent_skills/get_agent_skill 提供实时清单/全文，发现服务归 agent-skills。Markdown 端点仅兼容。用户不选择功能，Agent 通过 agent-workflows 选择执行流程；禁止在 RPC 判断自然语言或新增分类分支。
- 工具清单和 OpenAPI 从注册表派生，不再维护第二份手工清单。工具名必须唯一；已注册工具未被处理时必须报错，不得落入其他领域。
- 输入 schema 只用于发现，执行器仍须校验参数、授权范围、session/revision 和取消状态。`allowedPurposes` 不能替代领域内写入校验。
- `lunaEditorToolModule.ts` 的 fallback 仅兼容现有动态 iframe 工具，未来领域不得借此接入。剪辑导出确认和过期请求校验必须留在剪辑领域。
- auto 任务领取不激活剪辑，选择流程前禁止剪辑、音乐及计划写入；导演计划任务不激活剪辑窗口，不允许剪辑或音乐操作；不要依靠提示词代替服务端隔离。
- 发现文件是最新地址的稳定入口。更新指引或地址契约时同步检查 HTTP、stdio、提示词及发现文件生命周期，不固定端口、不扫描端口。
- 当前 `AiEditor*` 公共名称属于兼容契约；公共命名迁移应单独处理，不能顺便破坏 IPC 或 iframe。

## 验证索引

新增模块或路由策略：`scripts/test-luna-tool-modules.mjs`。
会话/取消/导出：`scripts/test-ai-editor-agent-session.mjs`、`scripts/test-luna-mcp-agent-contract.mjs`。
导演工具：`scripts/test-director-agent-tools.mjs`。stdio：`scripts/test-luna-mcp-stdio.mjs`。
只选择改动涉及的非界面用例；构建、界面测试仍遵守根目录授权规则。
