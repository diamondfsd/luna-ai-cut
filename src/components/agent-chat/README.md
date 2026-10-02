# 全局 AI 助手索引

维护规范：[AGENTS.md](AGENTS.md)。

| 职责 | 文件 |
| --- | --- |
| App 级入口状态与上下文 | `AgentChatProvider.tsx`、`agentChatContext.ts` |
| 右侧面板与任务/历史操作 | `AgentChatPanel.tsx`、`AgentChatPanel.css` |
| 底部输入、Agent 选择与发送 | `AgentComposer.tsx` |
| Agent 能力与安装状态 | `useAgentSelection.ts` |
| 当前会话事件订阅 | `useAgentActivity.ts` |
| 跨重启历史读取 | `useAgentHistory.ts` |
| 事件顺序与去重 | `mergeAgentActivity.ts` |
| 用户消息、进度、结果与确认 | `AgentActivity.tsx` |

UI → `window.luna.externalAgent` → [主进程协调器和适配器](../../../electron/features/external-agents/README.md)。
任务类型及历史契约见 [共享类型规则](../../shared/types/AGENTS.md)，提示词见 [提示词维护规则](../../lib/AGENTS.md)。
顶部下拉查看历史，选中记录只读；新对话的输入区选择 Agent。没有功能选择或本地历史编辑，后续在原 Agent 沟通。
新增领域工具/技能无需改面板，分流由 [Agent 自主流程](../../../electron/features/agent-workflows/README.md) 处理。完整架构见 [设计文档](../../../docs/app-agent-architecture.md)。
