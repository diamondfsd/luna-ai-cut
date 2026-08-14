import { z } from 'zod'
import type { AnimatableProperty, EasingType } from '@freecut/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import type { TransitionPresentation } from '@freecut/types/transition'
import { TEXT_STYLE_PRESETS, type TextStylePresetId } from '@freecut/shared/typography/text-style-presets'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { createClassicTrack } from '@freecut/features/timeline/utils/classic-tracks'
import { createTextTemplateItem } from '@freecut/features/timeline/utils/generated-layer-items'
import { readProjectSource } from './project-source-worktree'
import type {
  ProjectSourceJsonSchema,
  ProjectSourceTool,
  ProjectSourceToolResult,
} from './project-source-tools'

const MAX_INSPECT_ITEMS = 200
const MAX_EDIT_ITEMS = 50
const ANIMATABLE_PROPERTIES = [
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'rotation',
  'opacity',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'volume',
  'textStyleScale',
  'fontSize',
  'lineHeight',
  'textPadding',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
  'trimPathStart',
  'trimPathEnd',
  'trimPathOffset',
  'taperStartWidth',
  'taperEndWidth',
  'taperStartLength',
  'taperEndLength',
] as const
const EASING_TYPES = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const

type TimelineState = ReturnType<typeof useTimelineStore.getState>

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): ProjectSourceJsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function validate<S extends z.ZodType>(input: unknown, value: S) {
  const result = value.safeParse(input ?? {})
  if (result.success) return { ok: true as const, value: result.data as Record<string, unknown> }
  const issue = result.error.issues[0]
  return { ok: false as const, error: `${issue?.path.join('.') || 'args'}: ${issue?.message || '参数无效'}` }
}

function tool<S extends z.ZodType>(input: {
  name: string
  description: string
  inputSchema: ProjectSourceJsonSchema
  schema: S
  execute: (args: z.infer<S>) => Promise<ProjectSourceToolResult>
}): ProjectSourceTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    validate: (args) => validate(args, input.schema),
    execute: (args) => input.execute(args as z.infer<S>),
  }
}

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的剪辑项目。')
  return projectId
}

function timeline(): TimelineState {
  return useTimelineStore.getState()
}

function requireItem(itemId: string): TimelineItem {
  const item = timeline().items.find((candidate) => candidate.id === itemId)
  if (!item) throw new Error(`没有找到片段 ${itemId}。请先查看当前时间轴。`)
  return item
}

function secondsToFrame(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

function roundSeconds(frames: number, fps: number): number {
  return Math.round((frames / fps) * 1000) / 1000
}

function roundDurationSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}

function itemSummary(item: TimelineItem, tracks: readonly TimelineTrack[], fps: number): Record<string, unknown> {
  const track = tracks.find((candidate) => candidate.id === item.trackId)
  return {
    id: item.id,
    type: item.type,
    label: item.label,
    trackId: item.trackId,
    trackName: track?.name ?? '未命名轨道',
    fromSeconds: roundSeconds(item.from, fps),
    toSeconds: roundSeconds(item.from + item.durationInFrames, fps),
    durationSeconds: roundSeconds(item.durationInFrames, fps),
    ...(item.mediaId ? { mediaId: item.mediaId } : {}),
    ...(item.sourceStart !== undefined ? { sourceStart: item.sourceStart } : {}),
    ...(item.sourceEnd !== undefined ? { sourceEnd: item.sourceEnd } : {}),
    ...(item.speed !== undefined ? { speed: item.speed } : {}),
    ...(item.volume !== undefined ? { volume: item.volume } : {}),
    ...(item.type === 'text' ? { text: item.text } : {}),
  }
}

function inspectItems(args: {
  fromSeconds?: number
  toSeconds?: number
  trackId?: string
  limit?: number
}): Record<string, unknown> {
  const state = timeline()
  const fromFrame = args.fromSeconds === undefined ? 0 : secondsToFrame(args.fromSeconds, state.fps)
  const toFrame = args.toSeconds === undefined
    ? Number.POSITIVE_INFINITY
    : secondsToFrame(args.toSeconds, state.fps)
  const items = state.items
    .filter((item) => !args.trackId || item.trackId === args.trackId)
    .filter((item) => item.from < toFrame && item.from + item.durationInFrames > fromFrame)
    .sort((left, right) => left.from - right.from || left.id.localeCompare(right.id))
  const limit = Math.min(args.limit ?? MAX_INSPECT_ITEMS, MAX_INSPECT_ITEMS)
  return {
    fps: state.fps,
    range: {
      ...(args.fromSeconds !== undefined ? { fromSeconds: args.fromSeconds } : {}),
      ...(args.toSeconds !== undefined ? { toSeconds: args.toSeconds } : {}),
    },
    truncated: items.length > limit,
    items: items.slice(0, limit).map((item) => itemSummary(item, state.tracks, state.fps)),
    transitions: state.transitions
      .filter((transition) => {
        if (args.trackId && transition.trackId !== args.trackId) return false
        const left = state.items.find((item) => item.id === transition.leftClipId)
        const right = state.items.find((item) => item.id === transition.rightClipId)
        if (!left || !right) return false
        return left.from < toFrame && right.from + right.durationInFrames > fromFrame
      })
      .map((transition) => ({
        id: transition.id,
        type: transition.type,
        presentation: transition.presentation,
        leftClipId: transition.leftClipId,
        rightClipId: transition.rightClipId,
        trackId: transition.trackId,
        durationSeconds: roundSeconds(transition.durationInFrames, state.fps),
      })),
  }
}

function projectSummary(limit = MAX_INSPECT_ITEMS): Record<string, unknown> {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('当前没有打开的剪辑项目。')
  const state = timeline()
  const timelineEndFrame = state.items.reduce(
    (endFrame, item) => Math.max(endFrame, item.from + item.durationInFrames),
    0,
  )
  return {
    project: {
      id: project.id,
      name: project.name,
      durationSeconds: state.items.length > 0
        ? roundSeconds(timelineEndFrame, state.fps)
        : roundDurationSeconds(project.duration),
      width: project.metadata.width,
      height: project.metadata.height,
      fps: state.fps,
    },
    tracks: state.tracks
      .slice()
      .sort((left, right) => left.order - right.order)
      .map((track) => ({
        id: track.id,
        name: track.name,
        kind: track.kind,
        order: track.order,
        locked: track.locked,
        visible: track.visible,
        muted: track.muted,
        itemCount: state.items.filter((item) => item.trackId === track.id).length,
      })),
    ...inspectItems({ limit }),
  }
}

function validateTimelineState(state: TimelineState): string[] {
  const issues: string[] = []
  const trackIds = new Set<string>()
  for (const track of state.tracks) {
    if (trackIds.has(track.id)) issues.push(`轨道 ID 重复：${track.id}`)
    trackIds.add(track.id)
  }

  const itemIds = new Set<string>()
  for (const item of state.items) {
    if (itemIds.has(item.id)) issues.push(`片段 ID 重复：${item.id}`)
    itemIds.add(item.id)
    if (!trackIds.has(item.trackId)) issues.push(`片段 ${item.id} 引用了不存在的轨道。`)
    if (!Number.isFinite(item.from) || !Number.isFinite(item.durationInFrames) || item.durationInFrames <= 0) {
      issues.push(`片段 ${item.id} 的时间范围无效。`)
    }
  }

  for (const transition of state.transitions) {
    const left = state.items.find((item) => item.id === transition.leftClipId)
    const right = state.items.find((item) => item.id === transition.rightClipId)
    if (!left || !right || left.trackId !== right.trackId || left.trackId !== transition.trackId) {
      issues.push(`转场 ${transition.id} 的片段关系无效。`)
    }
  }
  for (const keyframes of state.keyframes) {
    if (!itemIds.has(keyframes.itemId)) issues.push(`关键帧引用了不存在的片段 ${keyframes.itemId}。`)
  }
  return issues
}

async function saveTimelineEdit(operation: string, before: Record<string, unknown>): Promise<ProjectSourceToolResult> {
  const state = timeline()
  const issues = validateTimelineState(state)
  if (issues.length > 0) throw new Error(`编辑结果未通过时间轴检查：${issues.join('；')}`)

  if (!getEmbeddedHostBridge().editingSourceGit) {
    throw new Error('当前运行环境不支持工程源码编辑。')
  }
  const projectId = currentProjectId()
  await state.saveTimeline(projectId)
  const compiled = await readProjectSource(projectId)
  if (!compiled?.timeline) {
    throw new Error('编辑结果没有成功写回当前工程。')
  }
  return {
    ok: true,
    message: `已完成${operation}，并保存到当前剪辑项目。`,
    data: {
      operation,
      before,
      after: projectSummary(),
      validation: { ok: true, issueCount: 0 },
    },
  }
}

async function saveItemEdit(operation: string, itemId: string, mutate: (item: TimelineItem) => void): Promise<ProjectSourceToolResult> {
  const beforeItem = requireItem(itemId)
  const before = itemSummary(beforeItem, timeline().tracks, timeline().fps)
  mutate(beforeItem)
  const afterItem = requireItem(itemId)
  const after = itemSummary(afterItem, timeline().tracks, timeline().fps)
  if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('没有产生可保存的变化。')
  return saveTimelineEdit(operation, { item: before })
}

const projectInspect = tool({
  name: 'project.inspect',
  description: '读取当前剪辑项目的结构化总览：轨道、片段 ID、时间范围、素材 ID、音量和转场。先调用它再规划剪辑操作。',
  inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: MAX_INSPECT_ITEMS } }),
  schema: z.object({ limit: z.number().int().min(1).max(MAX_INSPECT_ITEMS).optional() }),
  execute: async (args) => ({ ok: true, message: '已读取当前剪辑项目。', data: projectSummary(args.limit) }),
})

const timelineInspectContext = tool({
  name: 'timeline.inspect_context',
  description: '读取指定时间范围内的片段和转场，用于在局部剪辑前确认目标 ID。时间单位是秒。',
  inputSchema: schema({
    fromSeconds: { type: 'number', minimum: 0 },
    toSeconds: { type: 'number', minimum: 0 },
    trackId: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: MAX_INSPECT_ITEMS },
  }, ['fromSeconds', 'toSeconds']),
  schema: z.object({
    fromSeconds: z.number().min(0),
    toSeconds: z.number().min(0),
    trackId: z.string().optional(),
    limit: z.number().int().min(1).max(MAX_INSPECT_ITEMS).optional(),
  }).refine((args) => args.toSeconds > args.fromSeconds, { message: 'toSeconds 必须大于 fromSeconds' }),
  execute: async (args) => ({ ok: true, message: '已读取指定时间范围。', data: inspectItems(args) }),
})

const timelineTrim = tool({
  name: 'timeline.trim',
  description: '按时间轴上的绝对秒数裁剪片段。startSeconds 和 endSeconds 表示片段在成片时间轴上的新边界，至少提供一个。',
  inputSchema: schema({
    itemId: { type: 'string' },
    startSeconds: { type: 'number', minimum: 0 },
    endSeconds: { type: 'number', minimum: 0 },
  }, ['itemId']),
  schema: z.object({
    itemId: z.string().min(1),
    startSeconds: z.number().min(0).optional(),
    endSeconds: z.number().min(0).optional(),
  }).refine((args) => args.startSeconds !== undefined || args.endSeconds !== undefined, { message: '至少提供 startSeconds 或 endSeconds' }),
  execute: async (args) => saveItemEdit('裁剪片段', args.itemId, (item) => {
    const state = timeline()
    const nextStart = args.startSeconds === undefined ? item.from : secondsToFrame(args.startSeconds, state.fps)
    const nextEnd = args.endSeconds === undefined
      ? item.from + item.durationInFrames
      : secondsToFrame(args.endSeconds, state.fps)
    if (nextEnd <= nextStart) throw new Error('裁剪后的结束时间必须晚于开始时间。')
    if (args.startSeconds !== undefined) state.trimItemStart(item.id, nextStart - item.from)
    const current = requireItem(item.id)
    if (args.endSeconds !== undefined) state.trimItemEnd(item.id, nextEnd - (current.from + current.durationInFrames))
  }),
})

const timelineSplit = tool({
  name: 'timeline.split',
  description: '在指定的绝对时间点切分一个片段。切分点必须位于片段内部且不能落在已有转场区域。',
  inputSchema: schema({ itemId: { type: 'string' }, atSeconds: { type: 'number', minimum: 0 } }, ['itemId', 'atSeconds']),
  schema: z.object({ itemId: z.string().min(1), atSeconds: z.number().min(0) }),
  execute: async (args) => {
    const state = timeline()
    const item = requireItem(args.itemId)
    const splitFrame = secondsToFrame(args.atSeconds, state.fps)
    if (splitFrame <= item.from || splitFrame >= item.from + item.durationInFrames) {
      throw new Error('切分点必须位于片段内部。')
    }
    const originalIds = new Set(state.items.map((candidate) => candidate.id))
    state.splitItem(item.id, splitFrame)
    const freshState = timeline()
    const rightItem = freshState.items.find((candidate) =>
      candidate.id !== item.id &&
      !originalIds.has(candidate.id) &&
      candidate.trackId === item.trackId &&
      candidate.from === splitFrame,
    )
    if (!rightItem) throw new Error('切分点无效，或落在了转场区域内。')
    const saved = await saveTimelineEdit('切分片段', { item: itemSummary(item, state.tracks, state.fps) })
    return {
      ...saved,
      data: { ...(saved.data as Record<string, unknown>), split: {
        leftItemId: item.id,
        rightItemId: rightItem.id,
      } },
    }
  },
})

const timelineMove = tool({
  name: 'timeline.move',
  description: '移动片段到新的绝对时间位置，可选地移动到另一条轨道。时间单位是秒，轨道必须已存在。',
  inputSchema: schema({ itemId: { type: 'string' }, toSeconds: { type: 'number', minimum: 0 }, trackId: { type: 'string' } }, ['itemId', 'toSeconds']),
  schema: z.object({ itemId: z.string().min(1), toSeconds: z.number().min(0), trackId: z.string().optional() }),
  execute: async (args) => saveItemEdit('移动片段', args.itemId, (item) => {
    const state = timeline()
    const nextTrack = args.trackId ? state.tracks.find((track) => track.id === args.trackId) : undefined
    if (args.trackId && !nextTrack) throw new Error(`没有找到轨道 ${args.trackId}。`)
    if (nextTrack?.locked) throw new Error('目标轨道已锁定，无法移动片段。')
    state.moveItem(item.id, secondsToFrame(args.toSeconds, state.fps), args.trackId)
  }),
})

const timelineRemove = tool({
  name: 'timeline.remove',
  description: '删除一个或多个片段，并由编辑器同时清理相关转场、关键帧和成对音视频引用。',
  inputSchema: schema({ itemIds: { type: 'array', minItems: 1, maxItems: MAX_EDIT_ITEMS, items: { type: 'string' } } }, ['itemIds']),
  schema: z.object({ itemIds: z.array(z.string().min(1)).min(1).max(MAX_EDIT_ITEMS) }),
  execute: async (args) => {
    const state = timeline()
    const before = args.itemIds.map((itemId) => itemSummary(requireItem(itemId), state.tracks, state.fps))
    state.removeItems(args.itemIds)
    const remaining = new Set(state.items.map((item) => item.id))
    if (before.every((item) => remaining.has(String(item.id)))) throw new Error('没有删除任何片段。')
    return saveTimelineEdit('删除片段', { items: before })
  },
})

const timelineSetProperties = tool({
  name: 'timeline.set_properties',
  description: '修改片段的少量常用参数：名称、文字、音量、速度和淡入淡出。不要用它修改时间位置或轨道归属。',
  inputSchema: schema({
    itemId: { type: 'string' },
    label: { type: 'string', maxLength: 200 },
    text: { type: 'string', maxLength: 10000 },
    volume: { type: 'number', minimum: -60, maximum: 12 },
    speed: { type: 'number', minimum: 0.1, maximum: 10 },
    fadeIn: { type: 'number', minimum: 0 },
    fadeOut: { type: 'number', minimum: 0 },
  }, ['itemId']),
  schema: z.object({
    itemId: z.string().min(1),
    label: z.string().max(200).optional(),
    text: z.string().max(10000).optional(),
    volume: z.number().min(-60).max(12).optional(),
    speed: z.number().min(0.1).max(10).optional(),
    fadeIn: z.number().min(0).optional(),
    fadeOut: z.number().min(0).optional(),
  }).refine((args) => Object.values(args).some((value) => value !== undefined && value !== args.itemId), { message: '至少提供一个要修改的参数' }),
  execute: async (args) => saveItemEdit('修改片段参数', args.itemId, (item) => {
    if (args.text !== undefined && item.type !== 'text') throw new Error('只有文字片段可以修改文字内容。')
    if (args.volume !== undefined && item.type !== 'audio' && item.type !== 'video') throw new Error('只有音频或视频片段可以修改音量。')
    const updates: Partial<TimelineItem> = {
      ...(args.label !== undefined ? { label: args.label } : {}),
      ...(args.text !== undefined ? { text: args.text } : {}),
      ...(args.volume !== undefined ? { volume: args.volume } : {}),
      ...(args.speed !== undefined ? { speed: args.speed } : {}),
      ...(args.fadeIn !== undefined ? { fadeIn: args.fadeIn } : {}),
      ...(args.fadeOut !== undefined ? { fadeOut: args.fadeOut } : {}),
    }
    timeline().updateItem(item.id, updates)
  }),
})

const timelineSetTransform = tool({
  name: 'timeline.set_transform',
  description: '修改片段画面变换：位置、宽高、旋转、透明度、翻转和圆角。位置与尺寸使用画布像素。',
  inputSchema: schema({
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
  }, ['itemId']),
  schema: z.object({
    itemId: z.string().min(1),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    cornerRadius: z.number().min(0).optional(),
  }).refine((args) => Object.entries(args).some(([key, value]) => key !== 'itemId' && value !== undefined), { message: '至少提供一个变换参数' }),
  execute: async (args) => saveItemEdit('修改画面变换', args.itemId, (item) => {
    if (item.type === 'audio' || item.type === 'adjustment') throw new Error('该片段类型没有可修改的画面变换。')
    const { itemId, ...transform } = args
    timeline().updateItemTransform(itemId, transform)
  }),
})

const timelineSetAudio = tool({
  name: 'timeline.set_audio',
  description: '修改视频或音频片段的音量、淡入淡出和变调参数。音量单位是 dB。',
  inputSchema: schema({
    itemId: { type: 'string' },
    volume: { type: 'number', minimum: -60, maximum: 12 },
    fadeIn: { type: 'number', minimum: 0 },
    fadeOut: { type: 'number', minimum: 0 },
    pitchSemitones: { type: 'number', minimum: -12, maximum: 12 },
  }, ['itemId']),
  schema: z.object({
    itemId: z.string().min(1),
    volume: z.number().min(-60).max(12).optional(),
    fadeIn: z.number().min(0).optional(),
    fadeOut: z.number().min(0).optional(),
    pitchSemitones: z.number().min(-12).max(12).optional(),
  }).refine((args) => Object.entries(args).some(([key, value]) => key !== 'itemId' && value !== undefined), { message: '至少提供一个音频参数' }),
  execute: async (args) => saveItemEdit('修改音频参数', args.itemId, (item) => {
    if (item.type !== 'audio' && item.type !== 'video') throw new Error('只有视频或音频片段可以修改音频参数。')
    timeline().updateItem(item.id, {
      ...(args.volume !== undefined ? { volume: args.volume } : {}),
      ...(args.fadeIn !== undefined ? { audioFadeIn: args.fadeIn } : {}),
      ...(args.fadeOut !== undefined ? { audioFadeOut: args.fadeOut } : {}),
      ...(args.pitchSemitones !== undefined ? { audioPitchSemitones: args.pitchSemitones } : {}),
    })
  }),
})

const timelineAddText = tool({
  name: 'timeline.add_text',
  description: '在时间轴顶部新增一条文字图层。时间单位是秒；文字会放在独立字幕轨道，不覆盖现有片段。',
  inputSchema: schema({
    text: { type: 'string', minLength: 1, maxLength: 10000 },
    startSeconds: { type: 'number', minimum: 0 },
    durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 3600 },
    label: { type: 'string', maxLength: 200 },
    stylePresetId: { type: 'string' },
  }, ['text', 'startSeconds', 'durationSeconds']),
  schema: z.object({
    text: z.string().min(1).max(10000),
    startSeconds: z.number().min(0),
    durationSeconds: z.number().positive().max(3600),
    label: z.string().max(200).optional(),
    stylePresetId: z.string().optional(),
  }),
  execute: async (args) => {
    const state = timeline()
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    const preset = args.stylePresetId
      ? TEXT_STYLE_PRESETS.find((candidate) => candidate.id === args.stylePresetId)
      : undefined
    if (args.stylePresetId && !preset) throw new Error(`没有找到文字样式 ${args.stylePresetId}。`)
    const minOrder = state.tracks.reduce((lowest, track) => Math.min(lowest, track.order), 0)
    const track = createClassicTrack({ tracks: state.tracks, kind: 'subtitle', order: minOrder - 1 })
    const item = createTextTemplateItem({
      placement: {
        trackId: track.id,
        from: secondsToFrame(args.startSeconds, state.fps),
        durationInFrames: Math.max(1, secondsToFrame(args.durationSeconds, state.fps)),
        canvasWidth: project.metadata.width,
        canvasHeight: project.metadata.height,
        fps: state.fps,
      },
      label: args.label ?? preset?.label,
      text: args.text,
      textStylePresetId: args.stylePresetId as TextStylePresetId | undefined,
    })
    state.addItemOnNewTrack(item, [...state.tracks, track])
    return saveTimelineEdit('添加文字图层', { item: itemSummary(item, [...state.tracks, track], state.fps) })
  },
})

const timelineAddKeyframe = tool({
  name: 'timeline.add_keyframe',
  description: '为片段增加一个标量关键帧。atSeconds 是相对片段起点的时间，属性名使用工具列出的内置属性。',
  inputSchema: schema({
    itemId: { type: 'string' },
    property: { type: 'string', enum: ANIMATABLE_PROPERTIES },
    atSeconds: { type: 'number', minimum: 0 },
    value: { type: 'number' },
    easing: { type: 'string', enum: EASING_TYPES },
  }, ['itemId', 'property', 'atSeconds', 'value']),
  schema: z.object({
    itemId: z.string().min(1),
    property: z.enum(ANIMATABLE_PROPERTIES),
    atSeconds: z.number().min(0),
    value: z.number(),
    easing: z.enum(EASING_TYPES).optional(),
  }),
  execute: async (args) => {
    const state = timeline()
    const item = requireItem(args.itemId)
    const frame = secondsToFrame(args.atSeconds, state.fps)
    if (frame >= item.durationInFrames) throw new Error('关键帧时间必须位于片段内部。')
    const keyframeId = state.addKeyframe(
      item.id,
      args.property as AnimatableProperty,
      frame,
      args.value,
      args.easing as EasingType | undefined,
    )
    if (!keyframeId) throw new Error('关键帧没有成功创建，可能已经存在相同时间点的关键帧。')
    return saveTimelineEdit('添加关键帧', { itemId: item.id, property: args.property, atSeconds: args.atSeconds, value: args.value })
  },
})

const timelineAddTransition = tool({
  name: 'timeline.add_transition',
  description: '在同一轨道上相邻的两个片段之间添加转场。当前支持 crossfade，durationSeconds 使用秒。',
  inputSchema: schema({
    leftItemId: { type: 'string' },
    rightItemId: { type: 'string' },
    durationSeconds: { type: 'number', exclusiveMinimum: 0 },
    presentation: { type: 'string', maxLength: 100 },
  }, ['leftItemId', 'rightItemId']),
  schema: z.object({
    leftItemId: z.string().min(1),
    rightItemId: z.string().min(1),
    durationSeconds: z.number().positive().optional(),
    presentation: z.string().max(100).optional(),
  }),
  execute: async (args) => {
    const state = timeline()
    const left = requireItem(args.leftItemId)
    const right = requireItem(args.rightItemId)
    if (left.trackId !== right.trackId) throw new Error('转场两侧的片段必须位于同一轨道。')
    const added = state.addTransition(
      left.id,
      right.id,
      'crossfade',
      args.durationSeconds === undefined ? undefined : secondsToFrame(args.durationSeconds, state.fps),
      args.presentation as TransitionPresentation | undefined,
    )
    if (!added) throw new Error('转场无法添加，请确认两个片段相邻并且有足够的素材余量。')
    return saveTimelineEdit('添加转场', { leftItemId: left.id, rightItemId: right.id })
  },
})

const timelineValidate = tool({
  name: 'timeline.validate',
  description: '检查当前时间轴的轨道、片段、转场和关键帧引用。完成一组剪辑后调用它确认工程仍然完整。',
  inputSchema: schema({}),
  schema: z.object({}),
  execute: async () => {
    const issues = validateTimelineState(timeline())
    if (issues.length > 0) return { ok: false, message: `时间轴检查发现 ${issues.length} 个问题。`, data: { issues } }
    return { ok: true, message: '时间轴检查通过。', data: { issues: [], itemCount: timeline().items.length, trackCount: timeline().tracks.length } }
  },
})

export const TIMELINE_AI_TOOLS: readonly ProjectSourceTool[] = [
  projectInspect,
  timelineInspectContext,
  timelineTrim,
  timelineSplit,
  timelineMove,
  timelineRemove,
  timelineSetProperties,
  timelineSetTransform,
  timelineSetAudio,
  timelineAddText,
  timelineAddKeyframe,
  timelineAddTransition,
  timelineValidate,
]
