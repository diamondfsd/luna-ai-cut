# AI 剪辑 Agent 重构交接

更新时间：2026-08-11

工作树：`/Users/zhouchao/projects/luna-ai-cut/worktrees/luna-freecut-support`

## 当前状态

本轮改动尚未提交。工作树中包含 AI 剪辑 Agent 的工具按需加载、工作区命令整合、上下文窗口配置、真实 token 用量记录和按真实用量触发压缩等改动。

已完成验证：

- `pnpm run typecheck:freecut` 通过。
- `pnpm run build:app` 通过。
- 构建仅有现存的动态导入和大 chunk 警告，没有新增编译错误。
- 按要求未启动 Electron，也未执行 UI/E2E 或 AI Editing 测试。

## 目标架构

剪辑助手应被视为一个对视频工程源码执行编码工作的内置 Agent：

- 人工编辑与 AI 编辑操作同一套项目源码，渲染层直接依赖这套源码。
- AI 使用 `source.read`、`source.replace`、`source.create`、`source.remove` 修改文件。
- `source.replace` 使用原文匹配作为乐观并发控制；原文变化时失败，Agent 再读取并重试，不依赖 Git revision 校验。
- Git 只负责查看变更和提交，不作为人工编辑与 AI 编辑同步的额外协议。
- 工具定义按需加载，避免把全部工具 JSON Schema 放进每次模型请求。
- 对话只在真实输入 token 达到模型上下文窗口 80% 时压缩，不使用字符数或消息数量估算。

## 已完成改动

### 1. 工具按需加载

新增 `tool.load`，模型初始只拿到精简工具目录和 `tool.load` 的完整定义。模型先根据目录选择工具 ID，再加载最多 6 个工具的完整参数定义。后续原生工具调用轮次会根据已加载集合动态更新 tools。

关键文件：

- `packages/freecut-editor/src/features/ai-editing/deferred-tool-loader.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/tool-loader-tools.ts`
- `packages/freecut-editor/src/features/ai-editing/agent-prompt.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestration-drivers.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestrator.ts`

### 2. 查询和 Git 工具整合

原来的 `workspace.list/read/search` 以及 `git.status/diff/log/branch` 已从 Agent 工具清单移除，合并为一个 `workspace.exec`。

`workspace.exec` 不是系统 shell，而是跨平台 TypeScript 命令分发器，目前只支持：

- `ls`
- `rg`
- `sed -n`
- `wc`
- 只读的 `git status/diff/log/branch`

源码写入仍强制走专用 `source.*` 工具，提交仍走 `git.commit`。因此 Windows 不依赖 Bash、macOS 路径或外部命令。

关键文件：

- `packages/freecut-editor/src/features/ai-editing/workspace-command.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/coding-workspace-tools.ts`
- `packages/freecut-editor/src/features/ai-editing/tool-registry.ts`

### 3. 模型上下文窗口配置

AI 设置中新增“模型记忆长度（K）”：

- 默认 `256K`
- 最小 `16K`
- 最大 `2048K`
- 保存值使用 token 数，不是字符数

主进程配置代码已从模型请求服务中拆到独立文件，相关源文件均低于 500 行。

关键文件：

- `electron/aiEditingAssistantConfig.ts`
- `electron/aiEditingAssistantService.ts`
- `packages/freecut-editor/src/features/ai-editing/components/ai-provider-dialog.tsx`
- `src/shared/types/aiEditing.ts`
- `packages/freecut-editor/src/shared/host/embedded-host.tsx`

### 4. 真实 token 用量与缓存记录

所有流式 Chat Completions 请求已增加：

```ts
stream_options: { include_usage: true }
```

流消费器读取接口返回的：

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `prompt_tokens_details.cached_tokens`

并归一化为：

```ts
{
  promptTokens,
  completionTokens,
  totalTokens,
  cachedTokens
}
```

每次 Agent 模型调用会追加 `model-usage` 执行事件：

```ts
{
  protocol,
  round,
  promptTokens,
  completionTokens,
  totalTokens,
  cachedTokens,
  cachePercent
}
```

其中 `cachePercent = cachedTokens / promptTokens * 100`。模型上下文弹窗会按轮次显示输入、输出、总计、缓存和缓存占比；复制完整记录时也包含 usage。

关键文件：

- `electron/aiEditingAssistantStream.ts`
- `electron/aiEditingAssistantService.ts`
- `packages/freecut-editor/src/infrastructure/llm/types.ts`
- `packages/freecut-editor/src/infrastructure/llm/openai-chat-completions-llm-adapter.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestration-drivers.ts`
- `packages/freecut-editor/src/features/ai-editing/components/ai-editing-model-context-dialog.tsx`

### 5. 按真实输入 token 触发压缩

旧的消息数量和字符长度阈值已删除，也没有 token 估算逻辑。

当前规则：

1. 每轮 Agent 请求接收接口真实返回的 `promptTokens`。
2. 一次用户会话包含多次模型调用时，持久化该轮最大的 `promptTokens`。
3. 下一次用户发言开始前，读取模型配置的上下文窗口。
4. 只有 `lastPromptTokens >= contextWindowTokens * 0.8` 才压缩较早的完整用户/助手消息对。
5. 服务商未返回 usage 时不触发压缩。
6. 压缩完成后先清空旧用量，再以新一轮接口返回的真实用量覆盖。

数据保存在项目的 `ai-editing-conversation.json` 中，字段为 `lastPromptTokens`。

关键文件：

- `packages/freecut-editor/src/features/ai-editing/agent-harness/context-manager.ts`
- `packages/freecut-editor/src/features/ai-editing/conversation-context.ts`
- `packages/freecut-editor/src/features/ai-editing/store.ts`
- `packages/freecut-editor/src/infrastructure/storage/workspace-fs/ai-editing-conversation.ts`

## 尚未完成和已知风险

### P0：跨轮 Agent 工作上下文仍不完整

当前同一轮内部会持续追加 assistant tool call、tool result 和 continuation message，不会反复改写历史消息。但一轮结束后，`ai-editing-conversation.json` 仍只保存最终的 user/assistant 聊天消息。

因此下一轮会恢复用户目标和最终答复，但不会恢复上一轮的工具调用、工具结果、已加载工具集合、读取过的证据以及失败重试过程。模型仍可能在第二轮重新读取源码和素材证据。

建议下一步：

- 为每个用户轮次持久化完整、追加式的 Agent message 序列。
- 下一轮请求复用上一轮完整 response output，包括 assistant tool calls 和对应 tool results。
- UI 聊天消息与模型工作消息分开存储，前者用于展示，后者用于稳定上下文和前缀缓存。
- 压缩必须以完整工具交换为边界，不能截断 assistant tool call 与 tool result。

### P0：需要真实服务商联调 usage

尚未用实际模型接口验证 `stream_options.include_usage`。OpenAI SDK 支持该字段，但部分兼容服务商可能：

- 完全不返回 usage：当前行为是不记录、不压缩。
- 不支持 `stream_options` 并直接报错：当前没有针对该字段的兼容降级。
- 返回 usage 但不返回 `cached_tokens`：当前缓存 token 记为 0。

接手后应至少用当前配置的真实服务商完成一次含多轮工具调用的会话，并检查 `ai-editing-runs.json` 是否逐轮出现 `model-usage`。

### P1：模型调用记录没有保存完整响应原文

`model-context` 已保存完整请求消息和工具定义，`model-usage` 已保存用量；但当前 `model-response` 事件主要是轮次和 step 元数据，不一定包含模型完整原始返回。

如果产品要求“每次模型接口调用的完整请求和完整响应原文都可查看”，需要在 driver 收到结果后追加专用响应记录，并注意不要在日志中写入 API Key。

### P1：`workspace.exec` 命令帮助和路径规范仍需加强

当前只支持有限命令，不支持 `cat`。此前实际会话中模型尝试过 `cat`，也出现过目录路径末尾带 `/` 导致读取失败。提示词已经列出支持命令，但命令错误结果最好同时返回可调用示例；路径入口也可统一去除无意义的尾部斜杠。

### P1：工具按需加载需要真实任务回归

需要确认以下场景：

- 原生 function calling 下先 `tool.load` 再调用新工具。
- JSON fallback 下加载后，下一轮提示包含新增完整定义。
- `availableToolIds` 限制生效，不能加载任务范围外工具。
- 工具加载失败后模型能根据目录选择正确 ID，不陷入重复调用。

### P2：模型设置读取有一次额外调用

当前 `adapter.load()` 会读取配置，准备上下文时 `store.ts` 又调用一次 `getConfig()` 获取窗口长度。功能正确，但可将配置结果随 adapter load 返回或由统一配置状态缓存，避免重复 IPC。

## 推荐接手顺序

1. 用真实模型服务完成一次简单聊天和一次多工具编辑，确认 usage、缓存占比及调用记录展示。
2. 处理不支持 `stream_options` 的兼容服务商降级策略。
3. 设计并实现跨用户轮次的完整 Agent message 持久化，这是当前上下文稳定性的核心缺口。
4. 让压缩器以完整 tool exchange 为边界处理 Agent message，而不是只压缩展示聊天。
5. 补齐完整响应原文记录。
6. 回归 `tool.load`、`workspace.exec`、JSON fallback 和 Windows 路径行为。

## 工作树范围

当前 `git diff --stat` 为 33 个已跟踪文件发生变化，另有 5 个新增源文件和本交接文档。主要新增文件：

- `electron/aiEditingAssistantConfig.ts`
- `packages/freecut-editor/src/features/ai-editing/deferred-tool-loader.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestration-drivers.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/tool-loader-tools.ts`
- `packages/freecut-editor/src/features/ai-editing/workspace-command.ts`

交接前不要覆盖或回退当前工作树；这些改动尚未形成提交。
