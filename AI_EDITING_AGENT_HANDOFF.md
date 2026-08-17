# AI 剪辑 Agent 重构交接

更新时间：2026-08-11

工作树：`/Users/zhouchao/projects/luna-ai-cut/worktrees/luna-freecut-support`

## 当前状态

初始交接改动已由提交 `3be633cc` 落入当前分支。本次续作尚未提交，工作树中包含跨用户轮次 Agent 工作消息持久化、DeepSeek Harness 脚本编辑入口、完整轮次压缩和流式 usage 兼容降级。

已完成验证：

- `pnpm run typecheck:freecut` 通过。
- `pnpm run build:app` 通过。
- 构建仅有现存的动态导入和大 chunk 警告，没有新增编译错误。
- 按要求未启动 Electron，也未执行 UI/E2E 或 AI Editing 测试。

续作验证：

- FreeCut 定向测试覆盖可重放 transcript、完整 tool exchange、整轮压缩、会话存储和结构化工具契约。
- `pnpm test:ai-editing-stream` 与 `pnpm test:ai-editing-retry` 通过。
- `pnpm run typecheck:freecut` 与 `pnpm run build:app` 通过；构建仍只有现存警告。

## 目标架构

剪辑助手应被视为一个对视频工程执行结构化编辑工作的内置 Agent：

- 人工编辑与 AI 编辑操作同一套时间轴状态，渲染层直接依赖这套工程。
- AI 唯一可调用的编辑入口是 `edit.run_script`，通过脚本中的 `luna.*` SDK 读取素材、分析内容和编辑时间轴。
- 脚本支持变量、循环、判断、函数和 `async/await`，适合长视频抽帧结果筛选、批量剪辑和异步音频任务轮询。
- AI 不直接修改 `project.json` 或任何源码文件；能力适配器负责参数校验、级联关系、保存和结构化结果返回。
- 工具结果必须返回模型，由模型决定继续、修订还是结束；宿主不根据自然语言自行推进工作流。
- 对话只在真实输入 token 达到模型上下文窗口 80% 时压缩，不使用字符数或消息数量估算。

## 已完成改动

### 1. 稳定完整工具目录

已删除 `tool.load` 和延迟加载器。模型从首轮开始获得当前任务允许的完整工具定义；定义只位于稳定 system 提示词和 Native 函数目录，本轮仓库摘要与用户请求追加在历史消息之后，不会污染可缓存前缀。

关键文件：

- `packages/freecut-editor/src/features/ai-editing/tool-set.ts`
- `packages/freecut-editor/src/features/ai-editing/agent-prompt.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestration-drivers.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestrator.ts`

### 2. Harness 脚本编辑入口

模型从首轮开始只获得 `edit.run_script`。脚本由独立 Node.js 运行时执行，使用 `luna.*` SDK 调用宿主能力：

- `luna.media`：读取素材、画面分析和字幕证据。
- `luna.project`：读取项目状态和画布设置。
- `luna.timeline`：执行单项或批量时间轴编辑。
- `luna.audio`：提交配音/音乐后台任务并查询状态。

所有项目状态最终直接保存到 `project.json`，不再维护源码树、源码工具或 AI 专用 Git 工作树。

关键文件：

- `packages/freecut-editor/src/features/ai-editing/tools/coding-workspace-tools.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/project-tools.ts`
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

### 已完成：跨轮 Agent 工作上下文

会话文件已升级到 v3，UI 聊天消息与 `agentTurns` 分开存储。每轮保存可重放的 assistant tool calls、对应 tool results、continuation/final output 和 `loadedToolIds`；下一轮 native 原样复用，JSON 使用稳定文本化转换。归档与恢复会搬运完整状态。

压缩现在只以完整用户轮次为边界，保留最近两轮，不能截断 tool exchange。旧 v2 开发期测试会话按项目策略不迁移。

### P0：需要真实服务商联调 usage

尚未用实际模型接口验证 `stream_options.include_usage`。OpenAI SDK 支持该字段，但部分兼容服务商可能：

- 完全不返回 usage：当前行为是不记录、不压缩。
  - 不支持 `stream_options` 并直接报错：现已对明确的 400/422 参数不兼容错误降级重发；普通请求错误或已收到 chunk 后的错误不会重发。
- 返回 usage 但不返回 `cached_tokens`：当前缓存 token 记为 0。

接手后应至少用当前配置的真实服务商完成一次含多轮工具调用的会话，并检查 `ai-editing-runs.json` 是否逐轮出现 `model-usage`。

### P1：模型调用记录没有保存完整响应原文

`model-context` 已保存完整请求消息和工具定义，`model-usage` 已保存用量；但当前 `model-response` 事件主要是轮次和 step 元数据，不一定包含模型完整原始返回。

如果产品要求“每次模型接口调用的完整请求和完整响应原文都可查看”，需要在 driver 收到结果后追加专用响应记录，并注意不要在日志中写入 API Key。

### P1：稳定工具目录需要真实任务回归

需要确认以下场景：

- 原生 function calling 首轮可直接选择任意允许工具，后续轮次目录保持不变。
- JSON fallback 使用 system 前缀中的同一份完整定义。
- `availableToolIds` 限制生效，不能加载任务范围外工具。
- 模型优先在 `edit.run_script` 中使用 `luna.media.list()` 和 `luna.media.read()`，不尝试 Shell 命令或直接读取项目文件。

### P2：模型设置读取有一次额外调用

当前 `adapter.load()` 会读取配置，准备上下文时 `store.ts` 又调用一次 `getConfig()` 获取窗口长度。功能正确，但可将配置结果随 adapter load 返回或由统一配置状态缓存，避免重复 IPC。

## 推荐接手顺序

1. 用真实模型服务完成一次简单聊天和一次多工具编辑，确认 usage、缓存占比及调用记录展示。
2. 处理不支持 `stream_options` 的兼容服务商降级策略。
3. 用较大的真实项目回归 `media.list/media.read` 的分页、批量限制和上下文体积。
4. 检查多轮对话的 system/tool 前缀缓存命中率是否保持稳定。
5. 补齐完整响应原文记录。
6. 回归 Native/JSON fallback、结构化工具 allowlist 和 Windows 路径行为。

## 工作树范围

当前工作树包含此前续作和本轮结构化工具改造。主要新增文件：

- `electron/aiEditingAssistantConfig.ts`
- `packages/freecut-editor/src/features/ai-editing/orchestration-drivers.ts`
- `packages/freecut-editor/src/features/ai-editing/tool-set.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/project-tools.test.ts`
- `packages/freecut-editor/src/features/ai-editing/tools/coding-workspace-tools.test.ts`

交接前不要覆盖或回退当前工作树；这些改动尚未形成提交。
