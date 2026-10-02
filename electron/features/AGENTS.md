# 领域服务与 Agent 能力扩展

本规则约束各领域向外部 Agent 暴露能力的方式，不要求将所有领域服务改成 Agent 工具。

- 新功能在自己的领域目录维护服务、工具 schema、执行器及参数/资源访问校验，避免把新业务放进 `electron/mcp` 通用协议文件。
- 通过 `LunaToolModule` 接入 [应用工具组合层](../mcp/README.md)。领域服务不依赖 WorkBuddy、Codex 等应用适配器，也不依赖 React 页面。
- 明确只读与写入操作。写入须按实际风险检查会话、请求版本、资源范围、取消及必要确认；schema 或提示词不能代替校验。
- 注册工具的执行器必须处理自己声明的工具。结果与错误沿用公共契约，失败不能被自然语言或 HTTP 成功状态掩盖。
- 新领域应有自己的目录索引和 AI 维护规则，说明入口、依赖、持久化及相关非界面测试。
- 应用级记忆统一使用 memory 领域：区分原始记录、已确认偏好与分析，保留来源和项目范围，支持更正/删除；不能把任务历史直接当作确认偏好。

现有外部应用适配、任务交接与历史见 [external-agents](external-agents/README.md)。完整设计见 [全应用架构](../../docs/app-agent-architecture.md)。

现有业务领域：[导演计划规范与索引](director-lab/AGENTS.md)、[音乐规范与索引](music/AGENTS.md)。

Agent 根据技能自主选择流程见 [agent-workflows](agent-workflows/README.md)。

全应用实时技能清单与全文工具见 [agent-skills](agent-skills/README.md)。

应用级记忆规范见 [memory](memory/AGENTS.md)，个人空间规范见 [agent-space](agent-space/AGENTS.md)。记忆技能不声明业务 workflow，不能为记忆请求打开剪辑窗口。
