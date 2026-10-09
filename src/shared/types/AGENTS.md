# Agent 公共契约维护

本文件仅补充 Agent 契约；其他类型继续遵守根目录及所属领域规范。

| 契约 | 文件 | 边界 |
| --- | --- | --- |
| 应用适配能力与公开 API | `externalAgent.ts` | 公共任务输入与适配器内部提示词输入不同 |
| 任务原文、历史与交接结果 | `agentConversation.ts` | 持久化数据，跨重启读取 |
| 全局面板上下文 | `agentChat.ts` | 打开入口上下文，不含领域执行逻辑 |
| Agent 会话、事件与 HTTP 发现 | `aiEditor.ts` | 共享契约不依赖 Electron renderer |

- 类型层不得依赖 Electron、React 页面或领域实现。
- 新增/修改接口同步检查主进程实现、preload、IPC 和 renderer 调用方。
- 全局任务输入可省略 purpose，默认 auto；当前业务流程为 shooting、footage-creation、editing-workspace，不添加用户功能下拉。
- 新增执行流程同步更新公共 purpose、会话选择方法、agent-workflows 工具 schema、指引和模块策略，不仅扩展一个 union。
- 存档结构变化须评估旧历史读取和迁移。不能把损坏或不兼容历史静默覆盖为空数据。
- `draft/clipboard` 表示交接方式，不代表任务完成。原始请求、生成提示词和活动会话分别保留语义。
- 旧公共类型名称逐步按领域归并；本次新工程使用 `LunaEditProject`，不再扩展旧编辑器快照契约。

设计索引：[全应用架构](../../../docs/app-agent-architecture.md)、[IPC](../../../electron/ipc/AGENTS.md)、[全局面板](../../components/agent-chat/README.md)。
