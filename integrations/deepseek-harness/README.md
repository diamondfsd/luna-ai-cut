# DeepSeek Harness 适配层

这个目录只负责把 DeepSeek Harness 的 `edit.run_script` 接到 Luna JS SDK：

```text
Harness -> plugin -> runEditScript -> Luna JS SDK -> capability endpoint -> Electron host
```

它不实现时间线、媒体、渲染或 AI 业务逻辑，也不根据用户或模型文案推断意图。具体能力由宿主通过结构化 capability name 和参数提供。

## 文件职责

- `sdk-client.mjs`：通用 Luna JS SDK 的 transport 和命名空间方法生成器。
- `config.mjs`：统一解析 plugin 配置及 SDK/旧版环境变量。
- `script-runtime.mjs`：在独立 Node 进程执行 ESM 脚本，并向脚本注入 Luna SDK。
- `plugin.mjs`：Harness plugin，注册唯一编辑入口 `edit.run_script`；内置技能注册是可关闭的资源兼容选项，不参与能力执行。

## 脚本 SDK

脚本是 ESM 模块，唯一需要导出的入口是 `default async function main(luna)`。每个 SDK 方法返回结构化操作结果，
实际能力数据位于 `result.data`；编辑脚本应先读取当前项目，再从 `result.data` 读取结构化结果。所有请求都绑定到
宿主当前打开的项目，不要猜测或替换 `projectId`。

```js
export default async function main(luna) {
  const project = await luna.project.inspect()
  const media = await luna.media.list()
  if (media.data.items.length === 0) return { projectId: project.data.projectId, createdItemIds: [] }
  const added = await luna.timeline.addMedia({
    mediaId: media.data.items[0].id,
    startSeconds: 0,
  })
  return {
    projectId: project.data.projectId,
    createdItemIds: added.data.createdItemIds,
  }
}
```

### 能力分区

- `project.inspect()`：读取当前项目、画布、轨道、片段和计数。
- `media.list()`、`media.read({ mediaIds })`、`media.searchTranscript({ query, mediaIds? })`：读取素材和已有证据。
- `media.analyze({ mediaIds, kind })`：提交 `transcript` 或 `visual` 分析任务；用 `media.getAnalysisTask({ taskId })` 查询状态。
- `memory.read()`、`memory.search()`、`memory.update()`、`memory.remove()`：维护跨项目的用户剪辑偏好。记忆返回在 `data.entries`，更新和删除使用返回的准确 ID。
- `audio.startSpeech({ text, voice?, speed? })`：提交 TTS 任务。
- `audio.startMusic({ prompt, model?, durationSeconds?, guidanceScale? })`：提交音乐或音效任务。背景音乐使用 `small-music`，音效使用 `small-sfx`。
- `audio.getTask({ taskId })`：查询 TTS、音乐和音效任务。
- `timeline.inspectContext()`、`addMedia()`、`addMediaBatch()`、`trim()`、`split()`、`move()`、`remove()`、`setProperties()`、`setTransform()`、`setAudio()`、`addText()`、`addKeyframe()` 和 `addTransition()`：执行时间轴编辑。

时间轴时间参数均为秒：`trim` 使用 `startSeconds/endSeconds`，`split` 使用 `atSeconds`，`move` 使用
`toSeconds`。转场使用 `fromClipId`、`toClipId`、`type` 和 `durationSeconds`。

### 记忆和异步任务

记忆只保存跨项目可复用的用户偏好；本轮任务要求、当前项目临时规则和模型推断不写入记忆。更新已有偏好时
传入 `memoryId`，删除时只使用 `memory.read` 或 `memory.search` 返回的 ID。

素材分析、TTS、音乐和音效都是异步任务。提交方法立即返回 `data.taskId`，不能把提交成功当成生成完成。
保存 `taskId`，等待一小段时间后重复查询对应的任务方法：

```js
async function waitForTask(readTask, taskId) {
  for (;;) {
    const result = await readTask({ taskId })
    const task = result.data
    if (task.status === 'completed' || task.status === 'failed') return task
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

const submitted = await luna.audio.startMusic({
  prompt: '轻快、温暖的旅行背景音乐',
  model: 'small-music',
  durationSeconds: 8,
})
const task = await waitForTask(luna.audio.getTask, submitted.data.taskId)
if (task.status === 'failed') throw new Error(task.error || '音频生成失败')
const added = await luna.timeline.addMedia({ mediaId: task.mediaId, startSeconds: 0 })
```

`queued`、`preparing-model`、`generating` 和 `saving` 都表示仍在处理。只有 `completed` 且返回有效 `mediaId`
时，才能将音频放入时间轴；素材分析完成后再用 `media.read` 读取证据。失败时读取 `data.error`、`data.failures`
或任务中的错误字段并返回给模型。工具结果会回传模型，由模型决定下一步。

插件只注册一个 Harness 工具 `edit.run_script`；这些能力都通过脚本中的 `luna.*` 调用，不能作为独立的
Harness 工具名直接调用。插件和宿主不根据用户或模型文案推断意图，也不会自行宣布任务完成。

旧路径仍然有效：

- `scripts/deepseek-harness-script-runtime.mjs`
- `scripts/deepseek-harness-freecut-plugin.mjs`

这两个文件只做 re-export，便于现有 Electron、构建脚本和测试逐步切换到新目录。

## 配置

plugin 配置优先，其次读取环境变量。新名称和旧名称都支持：

| 配置 | 新环境变量 | 兼容环境变量 |
|---|---|---|
| endpoint | `LUNA_SDK_ENDPOINT` | `LUNA_ASSISTANT_CAPABILITY_ENDPOINT` / `LUNA_SCRIPT_ENDPOINT` |
| token | `LUNA_SDK_TOKEN` | `LUNA_ASSISTANT_CAPABILITY_TOKEN` / `LUNA_SCRIPT_TOKEN` |
| projectId | `LUNA_SDK_PROJECT_ID` | `LUNA_ASSISTANT_PROJECT_ID` / `LUNA_SCRIPT_PROJECT_ID` |
| sessionId | `LUNA_SDK_SESSION_ID` | `LUNA_ASSISTANT_SESSION_ID` / `LUNA_SCRIPT_SESSION_ID` |
| cwd | `LUNA_SDK_CWD` | `LUNA_ASSISTANT_CWD` / `LUNA_SCRIPT_CWD` |
| model | `LUNA_SDK_MODEL` | `LUNA_ASSISTANT_MODEL` / `LUNA_SCRIPT_MODEL` / `DEEPSEEK_MODEL` |

`endpoint`、`token`、`projectId` 和 `cwd` 始终是必需的。`model` 和 `sessionId` 只作为宿主会话上下文透传，不参与 SDK 能力执行。脚本 worker 会同时收到新旧 SDK 环境变量，确保旧脚本行为不变。

## Electron 接线要求

Electron 后续只需要在启动 Harness plugin 时提供同一份配置：

```js
{
  endpoint,
  token,
  projectId,
  cwd,
  model,
}
```

其中 `endpoint` 是宿主 capability HTTP 服务地址，`token` 与宿主校验使用同一值，`projectId` 是当前编辑项目，`cwd` 是 Harness workspace，`model` 和 `sessionId` 是可选会话上下文。Electron 不需要把 FreeCut action 或 Store 暴露给 Harness；只需在 endpoint 内注册通用 Luna SDK capability provider。

如果暂时只能通过环境变量接线，请至少设置：

```text
LUNA_ASSISTANT_CAPABILITY_ENDPOINT
LUNA_ASSISTANT_CAPABILITY_TOKEN
LUNA_ASSISTANT_PROJECT_ID
LUNA_ASSISTANT_CWD
LUNA_ASSISTANT_MODEL
```

Harness 的 profile/plugin 资源需要能加载 `integrations/deepseek-harness/plugin.mjs`。生产构建还需要把该目录和两个兼容脚本一起纳入资源；本次适配层没有修改 Electron 或构建配置。

## 测试

```bash
node integrations/deepseek-harness/test-adapter.mjs
node scripts/test-deepseek-harness-script-runtime.mjs
node scripts/test-deepseek-harness-vitest.mjs
```

`scripts/test-deepseek-harness-plugin.mjs` 还会读取内置技能源文件；如果技能构建产物不存在，它会在资源加载阶段失败，这不代表 SDK transport 或脚本运行时失败。
