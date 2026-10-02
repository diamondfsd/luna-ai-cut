# Agent 公共契约维护

本文件仅补充 Agent 契约；其他类型继续遵守根目录及所属领域规范。

| 契约 | 文件 | 边界 |
| --- | --- | --- |
| 应用适配能力与公开 API | `externalAgent.ts` | 公共任务输入与适配器内部提示词输入不同 |
| 任务原文、历史与交接结果 | `agentConversation.ts` | 持久化数据，跨重启读取 |
| 全局面板上下文 | `agentChat.ts` | 打开入口上下文，不含领域执行逻辑 |
| 现有会话、事件、HTTP 与桥接 | `aiEditor.ts` | 保留历史命名和兼容性 |

- 类型层不得依赖 Electron、React 页面或领域实现。
- 新增/修改接口同步检查主进程实现、preload、IPC、renderer 调用方；涉及 iframe 时还需检查 bridge 与契约测试。
- 全局任务输入可省略 purpose，默认 auto。保留旧 editing/director-plan 存档和调用兼容；不要添加用户功能下拉。
- 新增执行流程同步更新公共 purpose、会话选择方法、agent-workflows 工具 schema、指引和模块策略，不仅扩展一个 union。
- 存档结构变化须评估旧历史读取和迁移。不能把损坏或不兼容历史静默覆盖为空数据。
- `draft/clipboard` 表示交接方式，不代表任务完成。原始请求、生成提示词和活动会话分别保留语义。
- `AiEditor*` 名称仍承载兼容契约，公共重命名须单独迁移，不在扩展业务时随意改变。

设计索引：[全应用架构](../../../docs/app-agent-architecture.md)、[IPC](../../../electron/ipc/AGENTS.md)、[全局面板](../../components/agent-chat/README.md)。
