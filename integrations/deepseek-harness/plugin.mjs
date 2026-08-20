// DeepSeek Harness adapter for the Luna JS SDK.
//
// The adapter registers one protocol entry point. It does not inspect user
// messages, choose an editing workflow, or execute FreeCut operations. The
// host capability endpoint remains the owner of those capabilities.

import { registerBuiltInSkills } from '../../scripts/deepseek-harness-built-in-skills.mjs'
import { normalizeLunaConfig } from './config.mjs'
import { runEditScript } from './script-runtime.mjs'
import { LUNA_SDK_API } from './sdk-client.mjs'

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    data: {},
  },
  required: ['ok', 'message'],
  additionalProperties: true,
}

const SCRIPT_TOOL = {
  name: 'edit.run_script',
  description: '执行一段 Luna JS SDK 脚本。脚本必须导出 default async function main(luna)，通过 SDK 读取上下文、调用宿主能力并返回结构化结果。工具结果会原样回传给模型。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        minLength: 1,
        maxLength: 500_000,
        description: '完整的 ESM 脚本，必须导出 default async function main(luna)。',
      },
    },
    required: ['code'],
    additionalProperties: false,
  },
}

export const FREECUT_EXPOSED_TOOL_NAMES = [SCRIPT_TOOL.name]

export const name = 'luna-freecut-script-editing'
export const inject = ['tools', 'systemPrompt', 'skills']

export function renderToolResult(_args, value) {
  const text = JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text ?? String(value) }]
}

function sdkMethodReference() {
  return Object.entries(LUNA_SDK_API)
    .flatMap(([namespace, methods]) => Object.entries(methods).map(([method, capability]) => {
      return `- luna.${namespace}.${method}(args) -> ${capability}`
    }))
    .join('\n')
}

const SDK_USAGE_GUIDE = `
## Luna SDK 使用契约

每个 SDK 方法都返回结构化操作结果，宿主能力的实际数据统一位于 \`result.data\`：

~~~js
const result = await luna.project.inspect()
const project = result.data.project
~~~

所有编辑请求都绑定到宿主当前打开的项目。不要传入或猜测另一个 projectId；先调用
\`luna.project.inspect()\`，需要复核时间线时调用 \`luna.timeline.inspectContext()\`。

可用方法和参数如下：

- \`luna.project.inspect()\`: 返回 \`data.projectId\`、\`data.project\`、\`data.timeline\` 和计数信息。
- \`luna.media.list({ limit? })\`: 返回 \`data.items\` 和 \`data.total\`。
- \`luna.media.read({ mediaIds })\`: 读取素材元数据和已经生成的画面/字幕证据，结果在 \`data.items\`。
- \`luna.media.analyze({ mediaIds, kind })\`: 提交字幕或画面分析任务，\`kind\` 为 \`transcript\` 或 \`visual\`；立即返回 \`data.taskId\`。
- \`luna.media.getAnalysisTask({ taskId })\`: 查询素材分析任务；任务达到 \`completed\` 后再用 \`luna.media.read({ mediaIds })\` 读取结果，\`failed\` 时读取 \`data.error\` 和 \`data.failures\`。
- \`luna.media.searchTranscript({ query, mediaIds? })\`: 在已完成的字幕识别结果中搜索，结果在 \`data.matches\`。
- \`luna.memory.read({ memoryIds?, scope?, videoType?, limit? })\` 和 \`luna.memory.search({ query?, scope?, videoType?, limit? })\`：读取或检索跨项目的用户剪辑偏好，结果在 \`data.entries\`。
- \`luna.memory.update({ memoryId?, scope, videoType?, topic, preference, evidence? })\`：新增或更新可跨项目复用的偏好；更新已有记录时传入返回的 \`memoryId\`。
- \`luna.memory.remove({ memoryIds })\`：按 \`memory.read/search\` 返回的准确 ID 删除偏好，结果在 \`data.removedIds\` 和 \`data.missingIds\`。
- 记忆只保存跨项目的长期偏好；本轮任务要求、项目临时规则和模型自己的推断不要保存。是否值得保存由模型根据会话判断，宿主不根据文案猜测。
- \`luna.audio.startSpeech({ text, voice?, speed? })\`：提交本地 TTS 任务，立即返回 \`data.taskId\`。
- \`luna.audio.startMusic({ prompt, model?, durationSeconds?, guidanceScale? })\`：提交背景音乐或音效任务；\`model\` 使用 \`small-music\` 或 \`small-sfx\`，立即返回 \`data.taskId\`。
- \`luna.audio.getTask({ taskId })\`: 查询 TTS、音乐或音效任务；只有 \`status === 'completed'\` 且有 \`data.mediaId\` 时，才能把结果交给 \`timeline.addMedia\`，\`failed\` 时读取错误。
- \`luna.timeline.addTrack({ type: 'video' | 'audio', name?, order? })\`: 创建独立轨道并使用返回的 \`data.createdItemIds[0]\` 作为后续调用的 \`trackId\`。视频片段使用视频轨道；字幕、标题和其他画面叠加使用单独的视频轨道；原始视频伴侣音频留在原音频轨道；TTS、背景音乐和音效使用独立的音频轨道。
- \`luna.timeline.addMedia({ mediaId, startSeconds?, durationSeconds?, sourceStartSeconds?, sourceEndSeconds?, trackId? })\`。
- \`luna.timeline.addMediaBatch({ items: [...] })\`: \`items\` 使用 \`addMedia\` 的参数格式。
- \`luna.timeline.trim({ itemId, startSeconds?, endSeconds? })\`: 两个时间是时间轴上的绝对秒数，不是素材源区间。
- \`luna.timeline.split({ itemId, atSeconds })\`：在时间轴绝对位置切开片段。
- \`luna.timeline.move({ itemId, toSeconds, trackId? })\`：将片段起点移动到时间轴绝对位置。
- \`luna.timeline.remove({ itemIds })\`：删除一个或多个片段。
- \`luna.timeline.setProperties({ itemId, label?, text?, volume?, speed?, fadeIn?, fadeOut? })\`。
- \`luna.timeline.setTransform({ itemId, x?, y?, width?, height?, rotation?, opacity?, flipHorizontal?, flipVertical?, cornerRadius? })\`。
- \`luna.timeline.setAudio({ itemId, volume?, fadeIn?, fadeOut?, pitchSemitones? })\`。
- \`luna.timeline.addText({ text, startSeconds, durationSeconds, trackId?, style? })\`。
- \`luna.timeline.addKeyframe({ itemId, property, atSeconds, value, easing? })\`：当前 \`value\` 必须是数字。
- \`luna.timeline.addTransition({ fromClipId, toClipId, type: 'crossfade', durationSeconds, presentation?, direction?, properties? })\`。\`type\` 只能是 \`'crossfade'\`，需要淡化视觉样式时另传 \`presentation: 'fade'\`；不要把 \`'fade'\` 作为 \`type\`，也不要省略 \`type\`。两个参与转场的画面片段必须在同一视频轨道，并且在时间轴切点相邻（旧项目中的重叠转场除外）。相邻片段使用切点中心的源素材余量：前片段需要有未使用的源素材尾部，后片段需要有未使用的源素材头部；只要任一侧余量为 0，转场就不能创建。先从 \`timeline.inspectContext()\` 检查 \`from\`、\`durationInFrames\`、\`sourceStart\`、\`sourceEnd\` 和 \`sourceDuration\`，再选择不超过两侧余量的时长。如果工具返回失败，读取错误并调整片段源区间或改用片段的 \`fadeIn/fadeOut\`，不能假设转场已经存在。

剪辑前先规划轨道，不要把所有内容反复放到默认的 V1/A1：字幕和标题先创建独立视频轨道，TTS、背景音乐和音效先创建独立音频轨道，再把返回的轨道 ID 传给 \`addText\` 或 \`addMedia\`。调用后重新检查时间线，确认每个新项目确实落在预期轨道。

编辑结果通常在 \`result.data.project\`，新建片段 ID 在 \`result.data.createdItemIds\`，受影响 ID 在
\`result.data.affectedIds\`。异步能力的提交结果不是最终结果：保存 \`taskId\`，等待一小段时间后重复查询，
直到状态为 \`completed\` 或 \`failed\`。\`queued\`、\`preparing-model\`、\`generating\` 和 \`saving\` 都表示仍在处理，不能当作失败或完成。

异步任务脚本模式：

~~~js
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
~~~

不要把尚未完成的任务加入时间轴，也不要在没有调用查询方法的情况下声称模型已完成。素材分析返回 \`failed\` 时不能继续假设已有画面或字幕证据；应读取结构化错误并根据实际数据决定下一步。每次调用都等待结果，再根据返回的结构化数据决定下一步。
`.trim()

// This prompt documents the wire contract only. It deliberately does not
// tell the host how to interpret a user's request or when to stop a task.
export const SCRIPT_SYSTEM_PROMPT = `
The only editing tool exposed by this adapter is edit.run_script.

The argument must be an ESM module exporting:

export default async function main(luna) {
  return { ok: true }
}

The script may call the following Luna SDK methods. The adapter forwards each
structured call to the host capability endpoint and returns the host result;
the host and model own all business decisions.

The host binds every SDK call to the FreeCut project currently open in the
editor. Start by calling luna.project.inspect(); its result includes
data.projectId and data.project. Do not invent or substitute a projectId.

${sdkMethodReference()}

${SDK_USAGE_GUIDE}

The script result is returned to the model. No adapter code classifies user
messages or model text, changes the script, or declares a task complete.
`.trim()

function resolveConfig(config) {
  return normalizeLunaConfig(config)
}

function shouldRegisterSkills(config) {
  return config?.registerBuiltInSkills !== false
}

export async function apply(ctx, config) {
  const resolvedConfig = resolveConfig(config)
  if (shouldRegisterSkills(config)) await registerBuiltInSkills(ctx)

  ctx.tools.register({
    ...SCRIPT_TOOL,
    output: {
      schema: RESULT_SCHEMA,
      render: renderToolResult,
    },
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const result = await runEditScript(resolvedConfig, {
        code: args?.code,
        signal: exec.signal,
      })
      exec.signal.throwIfAborted()
      return result
    },
  })

  const disposePrompt = ctx.systemPrompt.section({
    name: 'luna-sdk: script protocol',
    order: 120,
    text: SCRIPT_SYSTEM_PROMPT,
  })
  return () => disposePrompt()
}
