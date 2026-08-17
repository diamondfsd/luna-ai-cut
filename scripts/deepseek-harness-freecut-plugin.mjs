// DeepSeek Harness plugin for the FreeCut script editing capability.
// The Harness owns the conversation, prompt assembly, agent loop, and UI.
// This plugin only registers typed tools and forwards their structured calls
// to the Electron host over a private loopback endpoint.

import { randomUUID } from 'node:crypto'
import { registerBuiltInSkills } from './deepseek-harness-built-in-skills.mjs'
import { runEditScript, SCRIPT_API } from './deepseek-harness-script-runtime.mjs'

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

// User memory is a host-owned capability. Its data is stored in Luna's
// private application directory, so it is available across projects without
// becoming part of any project's source tree.
const memoryTools = [
  {
    name: 'memory.read',
    description: '读取已经保存的用户长期剪辑偏好。默认返回有限条目；可按记忆 ID、范围或视频类型筛选。不会读取项目文件。',
    parameters: {
      type: 'object',
      properties: {
        memoryIds: { type: 'array', maxItems: 50, items: { type: 'string' } },
        scope: { type: 'string', enum: ['global', 'video-type'] },
        videoType: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory.search',
    description: '搜索用户长期剪辑偏好。query 是明确的检索词或主题；不搜索当前项目源码，也不把搜索结果当作当前任务要求。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 200 },
        scope: { type: 'string', enum: ['global', 'video-type'] },
        videoType: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memory.update',
    description: '新增或更新一条用户长期剪辑偏好。只有确认这是跨项目可复用的用户偏好时才使用；一次性任务要求和当前项目规则不要保存到这里。更新已有记录时必须传 memoryId。',
    parameters: {
      type: 'object',
      properties: {
        memoryId: { type: 'string' },
        scope: { type: 'string', enum: ['global', 'video-type'] },
        videoType: { type: 'string', maxLength: 200 },
        topic: { type: 'string', minLength: 1, maxLength: 2000 },
        preference: { type: 'string', minLength: 1, maxLength: 2000 },
        evidence: { type: 'string', maxLength: 1000 },
      },
      required: ['scope', 'topic', 'preference'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory.remove',
    description: '移除指定的用户长期剪辑偏好。必须使用 memory.read 或 memory.search 返回的记忆 ID；不会根据自然语言猜测要删除哪条记录。',
    parameters: {
      type: 'object',
      properties: {
        memoryIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'string' } },
      },
      required: ['memoryIds'],
      additionalProperties: false,
    },
  },
]

export const FREECUT_MEMORY_TOOL_NAMES = memoryTools.map(tool => tool.name)

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
    description: '使用本地模型分析指定素材：transcript 识别口播字幕，visual 使用 LFM2.5-VL-450M 对视频或图片抽帧并生成带时间点的场景描述。visual 未指定 intensity 时默认使用较快的 light；需要更密集的画面描述时再传 normal 或 strong。分析结果会保存，之后用 media.read 读取。',
    parameters: {
      type: 'object',
      properties: {
        mediaIds: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
        kind: { type: 'string', enum: ['transcript', 'visual'] },
        intensity: { type: 'string', enum: ['light', 'normal', 'strong'], default: 'light' },
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

const audioTools = [
  {
    name: 'audio.start_speech',
    description: '提交本地 MOSS TTS 语音生成任务。模型下载和生成会在后台进行，立即返回 taskId；必须使用 audio.get_task 查询，直到 status 为 completed 后才可读取 mediaId 并加入时间轴。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 10000 },
        voice: {
          type: 'string',
          enum: ['Junhao', 'Zhiming', 'Weiguo', 'Xiaoyu', 'Yuewen', 'Lingyu', 'Trump', 'Ava', 'Bella', 'Adam', 'Nathan', 'Soyo', 'Saki', 'Mortis', 'Umiri', 'Mei', 'Anon', 'Arisa'],
          default: 'Junhao',
        },
        speed: { type: 'number', minimum: 0.5, maximum: 2, default: 1 },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'audio.start_music',
    description: '提交本地 MusicGen 背景音乐生成任务。模型下载和生成会在后台进行，立即返回 taskId；必须使用 audio.get_task 查询，直到 status 为 completed 后才可读取 mediaId 并加入时间轴。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 1000 },
        model: { type: 'string', enum: ['musicgen-small'], default: 'musicgen-small' },
        durationSeconds: { type: 'number', minimum: 2, maximum: 30, default: 8 },
        guidanceScale: { type: 'number', minimum: 0, maximum: 10, default: 3 },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'audio.get_task',
    description: '查询当前项目的音频生成任务。只有 status 为 completed 且返回 mediaId 时，生成结果才可以加入时间轴；failed 时读取 error。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', minLength: 1 },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
]

export const FREECUT_AUDIO_TOOL_NAMES = audioTools.map(tool => tool.name)

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
    name: 'project.set_canvas',
    description: '修改当前剪辑项目的输出画布尺寸并保存。使用 aspectRatio 传入预设比例（例如 9:16）；需要精确输出分辨率时同时传入 width 和 height，二者只能选择一种方式。这里的 width/height 是输出分辨率像素，图层位置和尺寸不要使用像素。',
    parameters: {
      type: 'object',
      properties: {
        aspectRatio: { type: 'string', enum: ['16:9', '4:3', '2.35:1', '2:1', '1.85:1', '9:16', '3:4', '1:1', '1:2'] },
        width: { type: 'integer', minimum: 2 },
        height: { type: 'integer', minimum: 2 },
      },
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
    name: 'timeline.add_media',
    description: '将当前项目素材库中的一个素材放入时间轴。mediaId 来自 media.list；startSeconds 是成片时间轴上的绝对位置；sourceStartSeconds 和 sourceEndSeconds 可直接指定素材源文件要使用的范围，不需要先添加整段再裁剪；指定源范围时不要同时传 durationSeconds，时间轴时长会自动按源范围计算。没有指定源范围时 durationSeconds 可选。位置被占用时会放到目标轨道最近的可用位置；视频默认保留联动音轨。',
    parameters: {
      type: 'object',
      properties: {
        mediaId: { type: 'string' },
        startSeconds: { type: 'number', minimum: 0 },
        durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 3600 },
        sourceStartSeconds: { type: 'number', minimum: 0 },
        sourceEndSeconds: { type: 'number', exclusiveMinimum: 0 },
        trackId: { type: 'string' },
        linkAudio: { type: 'boolean' },
      },
      required: ['mediaId', 'startSeconds'],
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
    description: '修改片段画面变换。x/y 是画布内中心点的 0 到 1 归一化坐标（0.5 表示居中）；width/height 是占画布的 0 到 1 比例；cornerRadius 是相对画布短边的 0 到 1 比例。旋转使用角度，透明度使用 0 到 1。文字片段的 width/height 只是文字框大小，不会自动改变字号；需要同步调整字号时，在同一次调用中传 fontSizeRatio（字号占画布短边的比例，例如 0.08）。不要传入像素位置或尺寸。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        x: { type: 'number', minimum: 0, maximum: 1, description: '画布内中心点的归一化横坐标，0.5 为水平居中。' },
        y: { type: 'number', minimum: 0, maximum: 1, description: '画布内中心点的归一化纵坐标，0.5 为垂直居中。' },
        width: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '占画布宽度的归一化比例。' },
        height: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '占画布高度的归一化比例。' },
        rotation: { type: 'number' },
        opacity: { type: 'number', minimum: 0, maximum: 1 },
        flipHorizontal: { type: 'boolean' },
        flipVertical: { type: 'boolean' },
        cornerRadius: { type: 'number', minimum: 0, maximum: 1, description: '相对画布短边的归一化圆角比例。' },
        fontSizeRatio: { type: 'number', exclusiveMinimum: 0, maximum: 1, description: '仅适用于文字片段；字号占画布短边的比例，例如 0.08。文字框宽高不会自动改变字号。' },
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
    description: '在时间轴顶部新增一条文字图层。时间单位是秒；优先放入按轨道顺序最近的空闲字幕轨道，所有字幕轨道都冲突或不存在时才创建新的字幕轨道。未指定样式时文字水平居中并位于画面底部，背景色透明；指定 stylePresetId 时使用对应预设。',
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
    description: '为片段增加一个标量关键帧。atSeconds 是相对片段起点的时间。x/y/width/height/anchorX/anchorY/cornerRadius、crop 边界和柔化、fontSize/textPadding/textShadowOffsetX/textShadowOffsetY/textShadowBlur/strokeWidth、trimPathStart/trimPathEnd 和 taper 属性的 value 统一使用 0 到 1 的归一化值，不要传入像素；x/y 的 0.5 表示居中，文字阴影偏移的 0.5 表示无偏移。trimPathOffset 是 -360 到 360 的角度。crop 相对于素材源尺寸，文字和描边尺寸相对于画布短边。旋转使用角度，透明度使用 0 到 1，行高和文字样式缩放使用倍数，音量使用 dB。',
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        property: { type: 'string', enum: ['x', 'y', 'width', 'height', 'anchorX', 'anchorY', 'rotation', 'opacity', 'cornerRadius', 'cropLeft', 'cropRight', 'cropTop', 'cropBottom', 'cropSoftness', 'volume', 'textStyleScale', 'fontSize', 'lineHeight', 'textPadding', 'textShadowOffsetX', 'textShadowOffsetY', 'textShadowBlur', 'strokeWidth', 'trimPathStart', 'trimPathEnd', 'trimPathOffset', 'taperStartWidth', 'taperEndWidth', 'taperStartLength', 'taperEndLength'] },
        atSeconds: { type: 'number', minimum: 0 },
        value: { type: 'number', description: '空间、尺寸、文字、描边、裁剪和 trimPath/taper 比例属性使用 0 到 1；trimPathOffset 使用 -360 到 360 的角度；不要传入像素。x/y 与文字阴影偏移的 0.5 表示中心/无偏移。' },
        easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
      },
      required: ['itemId', 'property', 'atSeconds', 'value'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_transition',
    description: '在同一轨道上相邻的两个片段之间添加转场。presentation 必须是已注册的转场预设，默认使用 fade；需要方向的预设可传 direction，durationSeconds 使用秒。先调用 timeline.list_transitions 查看可用预设。',
    parameters: {
      type: 'object',
      properties: {
        leftItemId: { type: 'string' },
        rightItemId: { type: 'string' },
        durationSeconds: { type: 'number', exclusiveMinimum: 0 },
        presentation: { type: 'string', minLength: 1, maxLength: 100 },
        direction: { type: 'string', enum: ['from-left', 'from-right', 'from-top', 'from-bottom'] },
        alignment: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['leftItemId', 'rightItemId'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_media_batch',
    description: '一次将多个素材按给定顺序放入时间轴。适合已经确定多个素材和时间范围的剪辑；工具会逐项校验并返回所有新片段 ID。后续依赖这些 ID 的转场请等待本工具结果后再调用。',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              mediaId: { type: 'string' },
              startSeconds: { type: 'number', minimum: 0 },
              durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 3600 },
              sourceStartSeconds: { type: 'number', minimum: 0 },
              sourceEndSeconds: { type: 'number', exclusiveMinimum: 0 },
              trackId: { type: 'string' },
              linkAudio: { type: 'boolean' },
            },
            required: ['mediaId', 'startSeconds'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_text_batch',
    description: '一次按给定顺序添加多条字幕或文字图层。适合已经确定多条字幕内容和时间范围的剪辑；未指定样式时每条文字都没有背景色。',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
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
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.add_transition_batch',
    description: '一次按给定顺序添加多条转场。适合已经从 project.inspect 或前一批素材结果确认了相邻片段 ID 的剪辑；每条转场都必须满足同轨道、相邻且有足够素材余量。',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              leftItemId: { type: 'string' },
              rightItemId: { type: 'string' },
              durationSeconds: { type: 'number', exclusiveMinimum: 0 },
              presentation: { type: 'string', minLength: 1, maxLength: 100 },
              direction: { type: 'string', enum: ['from-left', 'from-right', 'from-top', 'from-bottom'] },
              alignment: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['leftItemId', 'rightItemId'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'timeline.list_transitions',
    description: '列出当前编辑器已注册且可渲染的转场预设、分类、方向和默认时长。添加转场前先用它确认 presentation 和 direction。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
]

const allTools = [...memoryTools, ...mediaTools, ...audioTools, ...timelineTools]

const SCRIPT_METHOD_NAMES = new Map(
  Object.entries(SCRIPT_API).flatMap(([namespace, methods]) =>
    Object.entries(methods).map(([method, name]) => [name, `luna.${namespace}.${method}`]),
  ),
)

function scriptMethodName(name) {
  return SCRIPT_METHOD_NAMES.get(name) || name
}

function scriptDescription(description) {
  let result = description
  for (const name of [...SCRIPT_METHOD_NAMES.keys()].sort((left, right) => right.length - left.length)) {
    result = result.replaceAll(name, scriptMethodName(name))
  }
  return result
}

const SCRIPT_API_REFERENCE = allTools.map((definition) => {
  const properties = definition.parameters?.properties ?? {}
  return `- ${scriptMethodName(definition.name)}(args): ${scriptDescription(definition.description)}\n  参数：${JSON.stringify(properties)}`
}).join('\n')

const EDITING_GUIDANCE = `
你正在操作 Luna AI Cut 的视频剪辑工程。时间轴是用户可以继续手工编辑的真实工程。你负责把用户的剪辑目标转化为可检查的时间轴修改，不要凭空猜测素材内容或片段 ID。

上下文层级：
- 当前用户在本轮对话中的明确要求，只对当前任务有效，优先级最高；不要把它自动写入用户记忆。
- 当前项目的 AGENTS.md 是项目级规则，描述这个项目应该如何剪辑。它由 Harness 作为工作区说明加载；不要把项目规则改写成用户长期偏好。
- memory.* 工具管理跨项目的用户长期偏好。它不读取或写入项目目录，当前任务上下文也不通过它保存。
- 冲突时按“当前用户明确要求 > 当前项目临时要求 > 项目 AGENTS.md > 用户长期偏好 > 默认规则”处理。长期偏好只是默认值，不能覆盖当前明确要求。

记忆工作流：
- 开始规划前，先调用 memory.search（无 query 可读取有限的全部偏好），并阅读 data.entries；它只提供默认倾向，不是本轮用户要求。
- 只有当用户明确表达跨项目、可复用的偏好，或明确确认某项纠正以后都应如此时，才调用 memory.update。模型负责判断这是否值得长期保存，宿主不根据用户或模型文案猜测意图。
- 更新前先用 memory.search 找已有记录；找到对应记录时传 memoryId 更新，避免重复创建。topic、preference 和 evidence 使用用户能理解的描述。
- 一次性时长、比例、素材选择、当前项目安排和本轮临时要求不要保存。项目专属规则放在项目 AGENTS.md，不要写入用户记忆。
- 删除记忆必须先用 memory.read 或 memory.search 获取准确的 memoryId，再调用 memory.remove；不要根据相似文案猜测删除目标。

信息收集：
- 开始规划前先调用 media.list 和 project.inspect。media.list 的 data.items 是素材清单，project.inspect 的 data.tracks 和 data.items 是时间轴结构；必须阅读这些 data 字段，不能只看工具返回的 message。
- 需要更改画布比例或尺寸时使用 project.set_canvas：常用比例传 aspectRatio（例如 9:16），精确尺寸同时传 width 和 height；不要直接编辑项目文件。
- 需要判断画面内容或口播时，先调用 media.read 读取已有证据。证据不存在或不够用时，对目标素材调用 media.analyze；初次粗选素材优先使用 intensity=light，只有需要更密集的场景证据时才使用 normal 或 strong，并在分析完成后再次调用 media.read；没有证据时明确说明未知，不要假装看过素材。
- 需要按台词寻找内容时使用 media.search_transcript。用返回的 mediaId 和时间范围制定剪辑方案，但仍要通过 project.inspect 或 timeline.inspect_context 确认时间轴片段 ID。
- 需要生成配音时使用 audio.start_speech，生成背景音乐时使用 audio.start_music。它们只提交后台任务并返回 taskId，不代表音频已经生成；必须循环调用 audio.get_task，直到 status 为 completed 或 failed。只有 completed 且存在 mediaId 时才可调用 timeline.add_media；failed 时读取 error，不要自行猜测失败原因。

规划与执行：
- 先将用户目标拆成素材选择、保留或删除的时间范围、轨道安排和必要的字幕/音频/转场操作；信息不足时先补充读取或向用户说明缺口。
- 剪辑操作必须使用 timeline.* 工具。时间轴位置和持续时间统一使用秒；timeline.add_keyframe 的 atSeconds 是相对于片段起点的秒数，不能误当成成片绝对时间。
- 画面位置和图层尺寸统一使用 0 到 1 的归一化值：timeline.set_transform 的 x/y 是画布中心点坐标，width/height 是画布比例；timeline.add_keyframe 的空间属性也遵循同一规则。不要向工具传入像素位置或尺寸；project.set_canvas 的 width/height 是输出画布分辨率，仍使用像素。
- 将素材加入时间轴使用 timeline.add_media，不要直接编辑项目文件。mediaId 必须来自 media.list；startSeconds 是成片时间轴上的绝对位置；需要只取素材的一段时，同时传 sourceStartSeconds 和 sourceEndSeconds，工具会直接创建这个源范围，不要先加入整段再调用 timeline.trim；trackId 只有在需要指定轨道时才传入。
- 同一轮已经确定多个素材、字幕或转场时，优先分别使用 timeline.add_media_batch、timeline.add_text_batch、timeline.add_transition_batch，一次提交同类操作；批量工具返回结果后再规划依赖新片段 ID 的下一批操作。
- 添加转场前先调用 timeline.list_transitions，presentation 只能使用返回的已注册预设；需要方向的预设再传 direction，未传 presentation 时默认使用 fade。
- 裁掉片段首尾使用 timeline.trim；删除完整片段或已经分割出的片段使用 timeline.remove；需要删除中间一段时先用 timeline.split 得到两侧片段，再移除不需要的片段。
- 修改画面、音频、文字、速度和关键帧时使用对应的 timeline 工具，不要通过移动片段来代替裁剪，也不要用猜测的 ID 重试。
- 一次只提交当前计划所需的最小修改；同类编辑尽量批量提交，不要在每个小操作前后重复调用 todo_write。每次编辑后阅读返回 data 中的 after、split 或其他结果，确认修改确实落在目标片段和目标时间上；失败后先重新读取最新上下文，再决定下一步。
- 文字片段调整 width/height 只会改变文字框，不会改变字号；需要让文字变大或变小时，在同一次 timeline.set_transform 调用中传 fontSizeRatio。未指定 stylePresetId 的 timeline.add_text 背景色透明；需要有色背景时必须明确指定样式预设。
- 保留已有音视频的关联、轨道顺序、转场和关键帧。删除片段优先使用 timeline.remove，让编辑器清理相关引用。

完成检查：
- 完成一组编辑后再次调用 project.inspect 或 timeline.inspect_context，确认片段数量、轨道、时间范围和素材 ID 与目标一致；编辑工具保存前会执行内部时间轴结构校验。
- 只有工具结果中的校验通过且目标确实已反映在时间轴中，才能向用户说明已经完成；如果只是完成了分析或方案，应如实说明当前状态。
`.trim()

const SCRIPT_EDITING_GUIDANCE = `
你正在操作 Luna AI Cut 的视频剪辑工程。模型唯一可调用的编辑能力是 edit.run_script；不要尝试直接调用任何 media、timeline、project、audio 或 memory 能力。

脚本格式必须是 ESM 模块，并导出一个默认异步函数：

export default async function main(luna) {
  const media = await luna.media.list()
  const selected = media.data.items.filter((item) => item.mediaType === 'video')
  await luna.timeline.addMediaBatch({ items: selected.map((item, index) => ({
    mediaId: item.id,
    startSeconds: index * 3,
    durationSeconds: 3,
  })) })
  return { selected: selected.length }
}

脚本支持完整 Node.js JavaScript 语法，包括变量、循环、条件、函数、数组、对象、Promise、async/await 和 Node.js 标准库。脚本中的剪辑 SDK 方法如下：

${SCRIPT_API_REFERENCE}

脚本约定：
- 所有时间使用秒；画面位置和图层尺寸遵循 SDK 方法说明中的单位。
- 长视频优先调用一次批量分析或批量读取能力，再在脚本内循环筛选，最后使用批量时间轴能力提交结果；不要为每一帧制造一轮模型调用。
- 每个重要编辑阶段都读取返回值并检查 data；脚本返回一个简短、结构化的结果，供下一轮模型判断。
- 音频任务查询可以在脚本内使用 await new Promise(resolve => setTimeout(resolve, 2000)) 等待；不要因为第一次返回 queued 或 preparing-model 就当作失败，也不要把 taskId 当作 mediaId。
- 不要直接修改项目文件。所有项目读取和修改都通过 luna SDK 完成。
- edit.run_script 的执行结果会返回模型；宿主不会根据脚本文案替模型判断任务是否完成。

以下是现有编辑能力对应的详细行为说明。它们只能通过上面的 luna SDK 方法调用：

${scriptDescription(EDITING_GUIDANCE)}
`.trim()

const SCRIPT_TOOL = {
  name: 'edit.run_script',
  description: '执行一段 Luna AI Cut 剪辑脚本。脚本是唯一的编辑入口；脚本必须导出 default async function main(luna)，通过 luna SDK 读取素材、分析内容、修改时间轴、生成音频或检查结果。脚本支持完整 Node.js JavaScript 语法。执行结果会返回模型，模型根据结果决定是否继续生成或修订脚本。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        minLength: 1,
        maxLength: 500_000,
        description: '完整的 ESM 剪辑脚本，必须导出 default async function main(luna)。',
      },
    },
    required: ['code'],
    additionalProperties: false,
  },
}

export const FREECUT_EXPOSED_TOOL_NAMES = [SCRIPT_TOOL.name]

export const name = 'luna-freecut-script-editing'
export const inject = ['tools', 'systemPrompt', 'skills', 'workspaceRegistry', 'agents', 'agentPresets', 'webServer']

export function renderToolResult(_args, value) {
  const text = JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text ?? String(value) }]
}

function validateConfig(config) {
  if (!config || typeof config.endpoint !== 'string' || typeof config.token !== 'string' || typeof config.projectId !== 'string'
    || typeof config.cwd !== 'string' || typeof config.model !== 'string') {
    throw new Error('luna-freecut-script-editing: endpoint, token, projectId, cwd and model are required')
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
  await registerBuiltInSkills(ctx)
  ctx.tools.register({
    ...SCRIPT_TOOL,
    output: {
      schema: RESULT_SCHEMA,
      render: renderToolResult,
    },
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const result = await runEditScript(config, { code: args.code, signal: exec.signal })
      exec.signal.throwIfAborted()
      return result
    },
  })

  await ctx.effect(async () => {
    const disposePrompt = ctx.systemPrompt.section({
      name: 'luna-freecut: script editing',
      order: 120,
      text: SCRIPT_EDITING_GUIDANCE,
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
