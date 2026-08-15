// DeepSeek Harness plugin for the FreeCut project-source capability.
// The Harness owns the conversation, prompt assembly, agent loop, and UI.
// This plugin only registers typed tools and forwards their structured calls
// to the Electron host over a private loopback endpoint. The WebUI receives a
// small host marker so its embedded-mode source changes stay scoped to FreeCut.

import { randomUUID } from 'node:crypto'

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

const sourceTools = [
  {
    name: 'source.tree',
    description: '列出当前剪辑工程中的源码文件和根目录 AGENTS.md，用于定位序列、轨道和片段数据。',
    parameters: {
      type: 'object',
      properties: { prefix: { type: 'string', description: '可选的目录前缀。' } },
      additionalProperties: false,
    },
  },
  {
    name: 'source.read',
    description: '读取当前剪辑工程中的一个 JSON 源码文件或根目录 AGENTS.md，返回带行号的有限范围内容。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.search',
    description: '在当前剪辑工程的源码文件和 AGENTS.md 中搜索指定文本，返回文件和行号。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        prefix: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'source.check',
    description: '解析并校验当前剪辑工程源码，确认时间轴结构完整。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'source.diff',
    description: '查看当前剪辑工程源码工作树中的文件级修改。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const mediaTools = [
  {
    name: 'media.list',
    description: '读取当前剪辑项目已关联素材的结构化信息，包括文件名、媒体类型、时长、尺寸、帧率、大小、编码和音频情况。不返回本地路径、文件句柄或素材内容。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
      additionalProperties: false,
    },
  },
  {
    name: 'media.read',
    description: '按素材 ID 读取已经生成的画面理解和带时间点的口播字幕。画面理解来自本地模型抽帧；没有完成分析时明确返回暂无结果，不会猜测内容。',
    parameters: {
      type: 'object',
      properties: {
        mediaIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
      },
      required: ['mediaIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'media.analyze',
    description: '使用本地模型分析指定素材：transcript 识别口播字幕，visual 对视频或图片抽帧并生成带时间点的画面描述。分析结果会保存，之后用 media.read 读取。',
    parameters: {
      type: 'object',
      properties: {
        mediaIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
        kind: { type: 'string', enum: ['transcript', 'visual'] },
        intensity: { type: 'string', enum: ['light', 'normal', 'strong'] },
      },
      required: ['mediaIds', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'media.search_transcript',
    description: '在已生成的素材字幕中搜索词语或短语，返回命中的素材 ID、时间范围和原文。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        mediaIds: { type: 'array', maxItems: 12, items: { type: 'string' } },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
]

const timelineTools = [
  {
    name: 'project.inspect',
    description: '读取当前剪辑项目的结构化总览：轨道、片段 ID、时间范围、素材 ID、音量和转场。先调用它再规划剪辑操作。',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.inspect_context',
    description: '读取指定时间范围内的片段和转场，用于在局部剪辑前确认目标 ID。时间单位是秒。',
    parameters: {
      type: 'object',
      properties: {
        fromSeconds: { type: 'number', minimum: 0 },
        toSeconds: { type: 'number', minimum: 0 },
        trackId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['fromSeconds', 'toSeconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.trim',
    description: '按时间轴上的绝对秒数裁剪片段。startSeconds 和 endSeconds 表示片段在成片时间轴上的新边界，至少提供一个。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        startSeconds: { type: 'number', minimum: 0 },
        endSeconds: { type: 'number', minimum: 0 },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.split',
    description: '在指定的绝对时间点切分一个片段。切分点必须位于片段内部且不能落在已有转场区域。',
    parameters: {
      type: 'object',
      properties: { itemId: { type: 'string' }, atSeconds: { type: 'number', minimum: 0 } },
      required: ['itemId', 'atSeconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.move',
    description: '移动片段到新的绝对时间位置，可选地移动到另一条轨道。时间单位是秒，轨道必须已存在。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        toSeconds: { type: 'number', minimum: 0 },
        trackId: { type: 'string' },
      },
      required: ['itemId', 'toSeconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.remove',
    description: '删除一个或多个片段，并由编辑器同时清理相关转场、关键帧和成对音视频引用。',
    parameters: {
      type: 'object',
      properties: {
        itemIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
      },
      required: ['itemIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.set_properties',
    description: '修改片段的少量常用参数：名称、文字、音量、速度和淡入淡出。不要用它修改时间位置或轨道归属。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        label: { type: 'string', maxLength: 200 },
        text: { type: 'string', maxLength: 10000 },
        volume: { type: 'number', minimum: -60, maximum: 12 },
        speed: { type: 'number', minimum: 0.1, maximum: 10 },
        fadeIn: { type: 'number', minimum: 0 },
        fadeOut: { type: 'number', minimum: 0 },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.set_transform',
    description: '修改片段画面变换：位置、宽高、旋转、透明度、翻转和圆角。位置与尺寸使用画布像素。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', exclusiveMinimum: 0 },
        height: { type: 'number', exclusiveMinimum: 0 },
        rotation: { type: 'number' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        flipHorizontal: { type: 'boolean' },
        flipVertical: { type: 'boolean' },
        cornerRadius: { type: 'number', minimum: 0 },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.set_audio',
    description: '修改视频或音频片段的音量、淡入淡出和变调参数。音量单位是 dB。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        volume: { type: 'number', minimum: -60, maximum: 12 },
        fadeIn: { type: 'number', minimum: 0 },
        fadeOut: { type: 'number', minimum: 0 },
        pitchSemitones: { type: 'number', minimum: -12, maximum: 12 },
      },
      required: ['itemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_text',
    description: '在时间轴顶部新增一条文字图层。时间单位是秒；文字会放在独立字幕轨道，不覆盖现有片段。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 10000 },
        startSeconds: { type: 'number', minimum: 0 },
        durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 3600 },
        label: { type: 'string', maxLength: 200 },
        stylePresetId: { type: 'string' },
      },
      required: ['text', 'startSeconds', 'durationSeconds'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_keyframe',
    description: '为片段增加一个标量关键帧。atSeconds 是相对片段起点的时间，属性名使用内置属性名。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        property: { type: 'string', enum: ['x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'rotation', 'opacity', 'cornerRadius', 'cropLeft', 'cropRight', 'cropTop', 'cropBottom', 'cropSoftness', 'volume', 'textStyleScale', 'fontSize', 'lineHeight', 'textPadding', 'textShadowOffsetX', 'textShadowOffsetY', 'textShadowBlur', 'strokeWidth', 'trimPathStart', 'trimPathEnd', 'trimPathOffset', 'taperStartWidth', 'taperEndWidth', 'taperStartLength', 'taperEndLength'] },
        atSeconds: { type: 'number', minimum: 0 },
        value: { type: 'number' },
        easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
      },
      required: ['itemId', 'property', 'atSeconds', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_transition',
    description: '在同一轨道上相邻的两个片段之间添加转场。当前支持 crossfade，durationSeconds 使用秒。',
    parameters: {
      type: 'object',
      properties: {
        leftItemId: { type: 'string' },
        rightItemId: { type: 'string' },
        durationSeconds: { type: 'number', exclusiveMinimum: 0 },
        presentation: { type: 'string', maxLength: 100 },
      },
      required: ['leftItemId', 'rightItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.validate',
    description: '检查当前时间轴的轨道、片段、转场和关键帧引用。完成一组剪辑后调用它确认工程仍然完整。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const allTools = [...sourceTools, ...mediaTools, ...timelineTools]

const EDITING_GUIDANCE = `
你正在操作 Luna AI Cut 的视频剪辑工程。时间轴是用户可以继续手工编辑的真实工程。

- 开始剪辑前先调用 media.list 读取项目素材，再调用 project.inspect 读取时间轴；时间轴为空时也要先根据 media.list 的素材信息规划下一步。
- 需要了解画面或口播时，先用 media.read 读取已有证据；没有证据时，调用 media.analyze，并在完成后再次调用 media.read。media.analyze 的 visual 会由本地模型抽帧理解画面，transcript 会由本地模型识别口播。
- 需要按台词定位内容时使用 media.search_transcript；返回的时间范围可用于后续时间轴规划。
- 剪辑操作必须使用 timeline.* 工具。时间位置和持续时间使用秒；关键帧的 atSeconds 是相对于片段起点的秒数。
- 不要直接编辑源码 JSON，不要使用 shell 或文件工具绕过时间轴工具。源码读取工具只用于诊断和确认，不是常规剪辑入口。
- 每次编辑工具都会保存工程并返回操作前后的摘要。遇到失败时读取最新上下文后再决定下一步，不要重复提交完全相同的调用。
- 完成一组编辑后调用 timeline.validate；只有校验通过并且目标确实已经反映在结果中，才能向用户说明已经完成。
- 保留已有音视频的关联、转场和关键帧；删除片段应优先使用 timeline.remove，让编辑器完成级联清理。
`.trim()

export const name = 'luna-freecut-project-source'
export const inject = ['tools', 'systemPrompt', 'workspaceRegistry', 'agents', 'agentPresets', 'webServer']

function abortableSignal(signal) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })
  return { controller, dispose: () => signal.removeEventListener('abort', abort) }
}

async function executeSourceTool(config, name, args, signal) {
  const { controller, dispose } = abortableSignal(signal)
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ projectId: config.projectId, name, args }),
      signal: controller.signal,
    })
    const payload = await response.json()
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `源码工具返回了 ${response.status}。`)
    return payload.result
  } finally {
    dispose()
  }
}

function validateConfig(config) {
  if (!config || typeof config.endpoint !== 'string' || typeof config.token !== 'string' || typeof config.projectId !== 'string'
    || typeof config.cwd !== 'string' || typeof config.model !== 'string') {
    throw new Error('luna-freecut-project-source: endpoint, token, projectId, cwd and model are required')
  }
}

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function markEmbeddedUi(html, cwd) {
  if (html.includes('data-luna-freecut')) return html
  return html.replace(/<html\b/i, `<html data-luna-freecut data-luna-freecut-cwd="${escapeAttribute(cwd)}"`)
}

async function initializeProjectWorkspace(ctx, config) {
  let workspace = await ctx.workspaceRegistry.resolveByPath(config.cwd)
  if (workspace === undefined) workspace = await ctx.workspaceRegistry.create(config.cwd)

  // A workspace with any persisted session is already usable: the client can
  // resume it, and its normal connect flow creates a blank session when needed.
  // Only the first run needs a host-owned blank session to make the workspace
  // immediately selectable by the WebUI's startup policy.
  if (workspace.sessionIds.length > 0) return undefined

  const handle = await ctx.agents.create({
    sessionId: randomUUID(),
    agentOptions: { provider: 'deepseek-official', model: config.model },
    meta: { cwd: workspace.path, agentPreset: 'luna-freecut' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'luna-freecut').then(() => undefined),
  })
  try {
    await workspace.attachSession(handle.agent.id)
    return handle
  } catch (error) {
    await handle.dispose()
    throw error
  }
}

export async function apply(ctx, config) {
  validateConfig(config)
  for (const definition of allTools) {
    ctx.tools.register({
      ...definition,
      output: {
        schema: RESULT_SCHEMA,
        render(_args, value) {
          return [{ type: 'text', text: typeof value?.message === 'string' ? value.message : JSON.stringify(value) ?? String(value) }]
        },
      },
      timeoutMs: (definition.name.startsWith('timeline.') && !definition.name.endsWith('inspect_context') && definition.name !== 'timeline.validate') || definition.name === 'media.analyze'
        ? 120_000
        : 30_000,
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const result = await executeSourceTool(config, definition.name, args, exec.signal)
        exec.signal.throwIfAborted()
        return result
      },
    })
  }

  await ctx.effect(async () => {
    const disposePrompt = ctx.systemPrompt.section({
      name: 'luna-freecut: timeline editing',
      order: 120,
      text: EDITING_GUIDANCE,
    })
    const untapIndex = ctx.webServer.tapIndex(html => markEmbeddedUi(html, config.cwd))
    let handle
    try {
      handle = await initializeProjectWorkspace(ctx, config)
    } catch (error) {
      // The UI can still open its workspace picker when startup initialization
      // fails; retain the diagnostic without taking down the Web server.
      ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    }
    return async () => {
      disposePrompt()
      untapIndex()
      if (handle !== undefined) await handle.dispose()
    }
  }, 'luna-freecut: WebUI adaptation')
}
