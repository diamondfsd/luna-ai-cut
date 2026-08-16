import { z } from 'zod'
import type { AnimatableProperty, EasingType } from '@freecut/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import type { TransitionPresentation } from '@freecut/types/transition'
import { TEXT_STYLE_PRESETS, type TextStylePresetId } from '@freecut/shared/typography/text-style-presets'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { resolveMediaUrl } from '@freecut/features/timeline/deps/media-library-resolver'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import { getMediaType } from '@freecut/features/media-library/utils/validation'
import { createClassicTrack, getTrackKind } from '@freecut/features/timeline/utils/classic-tracks'
import {
  buildDroppedMediaTimelineItems,
  getDroppedMediaDurationInFrames,
} from '@freecut/features/timeline/utils/dropped-media'
import { planTrackMediaDropPlacements } from '@freecut/features/timeline/utils/track-media-drop'
import { createTextTemplateItem } from '@freecut/features/timeline/utils/generated-layer-items'
import {
  CANVAS_ASPECT_RATIO_PRESETS,
  resizeCanvasToAspectRatio,
} from '@freecut/shared/projects/canvas-aspect-ratio'
import { commitProjectMetadataChange } from '@freecut/features/editor/utils/project-metadata-history'
import { captureSnapshot, restoreSnapshot, type TimelineSnapshot } from '@freecut/features/editor/deps/timeline-store'
import { transitionRegistry } from '@freecut/shared/timeline/transitions'
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
const TRANSITION_DIRECTIONS = ['from-left', 'from-right', 'from-top', 'from-bottom'] as const
const CANVAS_ASPECT_RATIO_IDS = CANVAS_ASPECT_RATIO_PRESETS.map((preset) => preset.id) as [string, ...string[]]
const NORMALIZED_KEYFRAME_PROPERTIES = new Set([
  'x',
  'y',
  'width',
  'height',
  'anchorX',
  'anchorY',
  'cornerRadius',
  'cropLeft',
  'cropRight',
  'cropTop',
  'cropBottom',
  'cropSoftness',
  'fontSize',
  'textPadding',
  'textShadowOffsetX',
  'textShadowOffsetY',
  'textShadowBlur',
  'strokeWidth',
  'trimPathStart',
  'trimPathEnd',
  'taperStartWidth',
  'taperEndWidth',
  'taperStartLength',
  'taperEndLength',
])

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
  execute: (args: z.infer<S>, signal?: AbortSignal) => Promise<ProjectSourceToolResult>
}): ProjectSourceTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    validate: (args) => validate(args, input.schema),
    execute: (args, signal) => input.execute(args as z.infer<S>, signal),
  }
}

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的剪辑项目。')
  return projectId
}

async function requireProjectMedia(mediaId: string) {
  const { mediaLibraryService } = await importMediaLibraryService()
  const media = (await mediaLibraryService.getMediaForProject(currentProjectId()))
    .find((candidate) => candidate.id === mediaId)
  if (!media) throw new Error(`没有找到素材 ${mediaId}。请先调用 media.list 获取当前项目的素材 ID。`)
  return media
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

function roundNormalized(value: number): number {
  return Math.round(value * 10000) / 10000
}

function normalizedTransformSummary(item: TimelineItem): Record<string, unknown> | undefined {
  const transform = item.transform
  const canvas = useProjectStore.getState().currentProject?.metadata
  if (!transform || !canvas || canvas.width <= 0 || canvas.height <= 0) return undefined
  const width = transform.width ?? canvas.width
  const height = transform.height ?? canvas.height
  return {
    x: roundNormalized(0.5 + (transform.x ?? 0) / canvas.width),
    y: roundNormalized(0.5 + (transform.y ?? 0) / canvas.height),
    width: roundNormalized(width / canvas.width),
    height: roundNormalized(height / canvas.height),
    rotation: transform.rotation ?? 0,
    opacity: transform.opacity ?? 1,
    ...(transform.anchorX !== undefined ? { anchorX: roundNormalized(transform.anchorX / width) } : {}),
    ...(transform.anchorY !== undefined ? { anchorY: roundNormalized(transform.anchorY / height) } : {}),
    ...(transform.cornerRadius !== undefined
      ? { cornerRadius: roundNormalized(transform.cornerRadius / Math.min(canvas.width, canvas.height)) }
      : {}),
    ...(transform.flipHorizontal !== undefined ? { flipHorizontal: transform.flipHorizontal } : {}),
    ...(transform.flipVertical !== undefined ? { flipVertical: transform.flipVertical } : {}),
  }
}

function getAiSourceDimensions(item: TimelineItem, project: { metadata: { width: number; height: number } }) {
  const dimensionSource = item as TimelineItem & {
    sourceWidth?: number
    sourceHeight?: number
    compositionWidth?: number
    compositionHeight?: number
    viewport?: { width?: number; height?: number }
  }
  const width = dimensionSource.sourceWidth ?? dimensionSource.compositionWidth ?? dimensionSource.viewport?.width
  const height = dimensionSource.sourceHeight ?? dimensionSource.compositionHeight ?? dimensionSource.viewport?.height
  return {
    width: typeof width === 'number' && Number.isFinite(width) && width > 0 ? width : project.metadata.width,
    height: typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : project.metadata.height,
  }
}

function convertNormalizedKeyframeValue(
  property: string,
  value: number,
  item: TimelineItem,
  project: { metadata: { width: number; height: number } },
): number {
  const sourceDimensions = getAiSourceDimensions(item, project)
  const sourceShortSide = Math.min(sourceDimensions.width, sourceDimensions.height)
  const canvasShortSide = Math.min(project.metadata.width, project.metadata.height)

  switch (property) {
    case 'x':
      return (value - 0.5) * project.metadata.width
    case 'y':
      return (value - 0.5) * project.metadata.height
    case 'width':
      return value * project.metadata.width
    case 'height':
      return value * project.metadata.height
    case 'anchorX':
      return value * (item.transform?.width ?? project.metadata.width)
    case 'anchorY':
      return value * (item.transform?.height ?? project.metadata.height)
    case 'cornerRadius':
      return value * canvasShortSide
    case 'cropLeft':
    case 'cropRight':
      return value * sourceDimensions.width
    case 'cropTop':
    case 'cropBottom':
      return value * sourceDimensions.height
    case 'cropSoftness':
      return value * sourceShortSide
    case 'fontSize':
    case 'textPadding':
    case 'textShadowBlur':
    case 'strokeWidth':
      return value * canvasShortSide
    case 'textShadowOffsetX':
    case 'textShadowOffsetY':
      return (value - 0.5) * canvasShortSide
    case 'trimPathStart':
    case 'trimPathEnd':
    case 'taperStartWidth':
    case 'taperEndWidth':
    case 'taperStartLength':
    case 'taperEndLength':
      return value * 100
    default:
      return value
  }
}

function itemSummary(item: TimelineItem, tracks: readonly TimelineTrack[], fps: number): Record<string, unknown> {
  const track = tracks.find((candidate) => candidate.id === item.trackId)
  const transform = normalizedTransformSummary(item)
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
    ...(transform ? { transform } : {}),
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
    if (!transitionRegistry.has(transition.presentation)) {
      issues.push(`转场 ${transition.id} 使用了未注册的预设 ${transition.presentation}。`)
    }
  }
  for (const keyframes of state.keyframes) {
    if (!itemIds.has(keyframes.itemId)) issues.push(`关键帧引用了不存在的片段 ${keyframes.itemId}。`)
  }
  return issues
}

async function saveTimelineEdit(
  operation: string,
  before: Record<string, unknown>,
  beforeSnapshot?: TimelineSnapshot,
  signal?: AbortSignal,
): Promise<ProjectSourceToolResult> {
  const projectId = currentProjectId()
  try {
    signal?.throwIfAborted()
    const state = timeline()
    const issues = validateTimelineState(state)
    if (issues.length > 0) throw new Error(`编辑结果未通过时间轴检查：${issues.join('；')}`)

    if (!getEmbeddedHostBridge().editingSourceGit) {
      throw new Error('当前运行环境不支持工程源码编辑。')
    }
    await state.saveTimeline(projectId)
    signal?.throwIfAborted()
    const compiled = await readProjectSource(projectId)
    if (!compiled?.timeline) {
      throw new Error('编辑结果没有成功写回当前工程。')
    }
    signal?.throwIfAborted()
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
  } catch (error) {
    if (beforeSnapshot) {
      restoreSnapshot(beforeSnapshot)
      try {
        await timeline().saveTimeline(projectId)
      } catch {
        // Preserve the original tool error. The in-memory timeline is restored;
        // the next normal project save can retry the source rollback.
      }
    }
    throw error
  }
}

async function saveItemEdit(
  operation: string,
  itemId: string,
  mutate: (item: TimelineItem) => void,
  signal?: AbortSignal,
): Promise<ProjectSourceToolResult> {
  const beforeItem = requireItem(itemId)
  const before = itemSummary(beforeItem, timeline().tracks, timeline().fps)
  const beforeSnapshot = captureSnapshot()
  signal?.throwIfAborted()
  const beforeSerialized = JSON.stringify(beforeItem)
  mutate(beforeItem)
  const afterItem = requireItem(itemId)
  if (beforeSerialized === JSON.stringify(afterItem)) throw new Error('没有产生可保存的变化。')
  return saveTimelineEdit(operation, { item: before }, beforeSnapshot, signal)
}

const projectInspect = tool({
  name: 'project.inspect',
  description: '读取当前剪辑项目的结构化总览：轨道、片段 ID、时间范围、素材 ID、音量和转场。先调用它再规划剪辑操作。',
  inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: MAX_INSPECT_ITEMS } }),
  schema: z.object({ limit: z.number().int().min(1).max(MAX_INSPECT_ITEMS).optional() }),
  execute: async (args) => ({ ok: true, message: '已读取当前剪辑项目。', data: projectSummary(args.limit) }),
})

const projectSetCanvas = tool({
  name: 'project.set_canvas',
  description: '修改当前剪辑项目的输出画布尺寸并保存。使用 aspectRatio 传入预设比例（例如 9:16）；需要精确输出分辨率时同时传入 width 和 height，二者只能选择一种方式。这里的 width/height 是输出分辨率像素，图层位置和尺寸不要使用像素。',
  inputSchema: schema({
    aspectRatio: { type: 'string', enum: CANVAS_ASPECT_RATIO_IDS },
    width: { type: 'integer', minimum: 2 },
    height: { type: 'integer', minimum: 2 },
  }),
  schema: z.object({
    aspectRatio: z.enum(CANVAS_ASPECT_RATIO_IDS).optional(),
    width: z.number().int().min(2).optional(),
    height: z.number().int().min(2).optional(),
  }).superRefine((args, context) => {
    const hasExplicitSize = args.width !== undefined || args.height !== undefined
    if (args.aspectRatio === undefined && (args.width === undefined || args.height === undefined)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: '请提供 aspectRatio，或同时提供 width 和 height' })
    }
    if (args.aspectRatio !== undefined && hasExplicitSize) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'aspectRatio 与 width/height 只能选择一种方式' })
    }
  }),
  execute: async (args, signal) => {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()

    const nextSize = args.aspectRatio
      ? resizeCanvasToAspectRatio(
          project.metadata,
          CANVAS_ASPECT_RATIO_PRESETS.find((preset) => preset.id === args.aspectRatio)!.ratio,
        )
      : { width: args.width!, height: args.height! }
    const before = {
      width: project.metadata.width,
      height: project.metadata.height,
    }

    try {
      await commitProjectMetadataChange({
        project,
        updates: nextSize,
        command: {
          type: 'UPDATE_PROJECT_METADATA',
          payload: { fields: ['width', 'height'], operation: 'set-canvas' },
        },
        updateProject: useProjectStore.getState().updateProject,
        markDirty: useTimelineStore.getState().markDirty,
      })
      signal?.throwIfAborted()
    } catch (error) {
      restoreSnapshot(beforeSnapshot)
      throw error
    }

    const updatedProject = useProjectStore.getState().currentProject
    if (!updatedProject) throw new Error('画布尺寸更新后没有找到当前项目。')
    return {
      ok: true,
      message: `画布已调整为 ${updatedProject.metadata.width}x${updatedProject.metadata.height}。`,
      data: {
        operation: '修改画布尺寸',
        before,
        after: {
          width: updatedProject.metadata.width,
          height: updatedProject.metadata.height,
          ...(args.aspectRatio ? { aspectRatio: args.aspectRatio } : {}),
        },
      },
    }
  },
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
  execute: async (args, signal) => saveItemEdit('裁剪片段', args.itemId, (item) => {
    const state = timeline()
    const nextStart = args.startSeconds === undefined ? item.from : secondsToFrame(args.startSeconds, state.fps)
    const nextEnd = args.endSeconds === undefined
      ? item.from + item.durationInFrames
      : secondsToFrame(args.endSeconds, state.fps)
    if (nextEnd <= nextStart) throw new Error('裁剪后的结束时间必须晚于开始时间。')
    if (args.startSeconds !== undefined) state.trimItemStart(item.id, nextStart - item.from)
    const current = requireItem(item.id)
    if (args.endSeconds !== undefined) state.trimItemEnd(item.id, nextEnd - (current.from + current.durationInFrames))
  }, signal),
})

const timelineSplit = tool({
  name: 'timeline.split',
  description: '在指定的绝对时间点切分一个片段。切分点必须位于片段内部且不能落在已有转场区域。',
  inputSchema: schema({ itemId: { type: 'string' }, atSeconds: { type: 'number', minimum: 0 } }, ['itemId', 'atSeconds']),
  schema: z.object({ itemId: z.string().min(1), atSeconds: z.number().min(0) }),
  execute: async (args, signal) => {
    const state = timeline()
    const item = requireItem(args.itemId)
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()
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
    const saved = await saveTimelineEdit('切分片段', { item: itemSummary(item, state.tracks, state.fps) }, beforeSnapshot, signal)
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
  execute: async (args, signal) => saveItemEdit('移动片段', args.itemId, (item) => {
    const state = timeline()
    const nextTrack = args.trackId ? state.tracks.find((track) => track.id === args.trackId) : undefined
    if (args.trackId && !nextTrack) throw new Error(`没有找到轨道 ${args.trackId}。`)
    if (nextTrack?.locked) throw new Error('目标轨道已锁定，无法移动片段。')
    state.moveItem(item.id, secondsToFrame(args.toSeconds, state.fps), args.trackId)
  }, signal),
})

const timelineAddMedia = tool({
  name: 'timeline.add_media',
  description: '将当前项目素材库中的一个素材放入时间轴。mediaId 来自 media.list；startSeconds 是成片时间轴上的绝对位置；sourceStartSeconds 和 sourceEndSeconds 可直接指定素材源文件要使用的范围，不需要先添加整段再裁剪；durationSeconds 可选，用于指定时间轴上的持续时长。位置被占用时会放到目标轨道最近的可用位置；视频默认保留联动音轨。',
  inputSchema: schema({
    mediaId: { type: 'string' },
    startSeconds: { type: 'number', minimum: 0 },
    durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: 3600 },
    sourceStartSeconds: { type: 'number', minimum: 0 },
    sourceEndSeconds: { type: 'number', exclusiveMinimum: 0 },
    trackId: { type: 'string' },
    linkAudio: { type: 'boolean' },
  }, ['mediaId', 'startSeconds']),
  schema: z.object({
    mediaId: z.string().min(1),
    startSeconds: z.number().min(0),
    durationSeconds: z.number().positive().max(3600).optional(),
    sourceStartSeconds: z.number().min(0).optional(),
    sourceEndSeconds: z.number().positive().optional(),
    trackId: z.string().min(1).optional(),
    linkAudio: z.boolean().optional(),
  }).superRefine((args, context) => {
    const hasStart = args.sourceStartSeconds !== undefined
    const hasEnd = args.sourceEndSeconds !== undefined
    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceStartSeconds 和 sourceEndSeconds 必须同时提供',
      })
    }
    if (hasStart && hasEnd && args.sourceEndSeconds! <= args.sourceStartSeconds!) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceEndSeconds 必须大于 sourceStartSeconds',
      })
    }
    if (hasStart && args.durationSeconds !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '指定源范围时不要同时提供 durationSeconds，时间轴时长会由源范围自动计算',
      })
    }
  }),
  execute: async (args, signal) => {
    const state = timeline()
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()

    const media = await requireProjectMedia(args.mediaId)
    signal?.throwIfAborted()
    const mediaType = getMediaType(media.mimeType)
    if (mediaType === 'unknown') throw new Error(`素材 ${media.fileName} 的类型不支持放入时间轴。`)

    const sourceRange = args.sourceStartSeconds === undefined
      ? undefined
      : (() => {
          if (mediaType === 'image') throw new Error('图片素材没有可裁剪的源时间范围。')
          if (!Number.isFinite(media.duration) || media.duration <= 0) {
            throw new Error(`素材 ${media.fileName} 没有有效的时长信息，无法按源范围添加。`)
          }
          if (args.sourceEndSeconds! > media.duration) {
            throw new Error(`素材源范围不能超过素材时长 ${roundDurationSeconds(media.duration)} 秒。`)
          }
          const sourceFps = media.fps && media.fps > 0 ? media.fps : state.fps
          const sourceStart = Math.round(args.sourceStartSeconds! * sourceFps)
          const sourceEnd = Math.round(args.sourceEndSeconds! * sourceFps)
          if (sourceEnd <= sourceStart) {
            throw new Error('源范围换算后不足一帧，请扩大 sourceStartSeconds 和 sourceEndSeconds 的间隔。')
          }
          return {
            sourceFps,
            sourceStart,
            sourceEnd,
            startSeconds: args.sourceStartSeconds!,
            endSeconds: args.sourceEndSeconds!,
          }
        })()

    const preferredKind = mediaType === 'audio' ? 'audio' : 'video'
    let planningTracks = state.tracks
    let targetTrack = args.trackId
      ? state.tracks.find((track) => track.id === args.trackId)
      : state.tracks.find((track) => !track.locked && getTrackKind(track) === preferredKind)
        ?? state.tracks.find((track) => !track.locked)
    if (!targetTrack && !args.trackId && state.tracks.length === 0) {
      targetTrack = createClassicTrack({ tracks: state.tracks, kind: preferredKind, order: 0 })
      planningTracks = [targetTrack]
    }
    if (!targetTrack) {
      throw new Error(args.trackId ? `没有找到轨道 ${args.trackId}。` : '没有可用于放置素材的未锁定轨道。')
    }
    if (targetTrack.locked) throw new Error(`目标轨道 ${targetTrack.name} 已锁定，无法放入素材。`)

    const linkAudio = args.linkAudio ?? true
    const durationInFrames = args.durationSeconds === undefined
      ? sourceRange
        ? Math.max(1, Math.round(((sourceRange.sourceEnd - sourceRange.sourceStart) * state.fps) / sourceRange.sourceFps))
        : getDroppedMediaDurationInFrames(media, mediaType, state.fps)
      : Math.max(1, secondsToFrame(args.durationSeconds, state.fps))
    const { plannedItems, tracks: workingTracks } = planTrackMediaDropPlacements({
      entries: [{
        payload: media,
        label: media.fileName,
        mediaType,
        durationInFrames,
        hasLinkedAudio: mediaType === 'video' && linkAudio && !!media.audioCodec,
      }],
      dropFrame: secondsToFrame(args.startSeconds, state.fps),
      tracks: planningTracks,
      existingItems: state.items,
      dropTargetTrackId: targetTrack.id,
    })
    const planned = plannedItems[0]
    if (!planned) throw new Error('没有找到目标轨道上的可用位置，素材没有加入时间轴。')

    const lockedPlacement = planned.placements.find((placement) =>
      state.tracks.find((track) => track.id === placement.trackId)?.locked,
    )
    if (lockedPlacement) throw new Error('素材需要使用的联动轨道已锁定，无法加入时间轴。')

    const blobUrl = await resolveMediaUrl(media.id)
    if (!blobUrl) throw new Error(`素材 ${media.fileName} 当前无法读取，未加入时间轴。`)
    const primaryPlacement = planned.placements.find((placement) => placement.mediaType !== 'audio') ?? planned.placements[0]!
    const linkedAudioPlacement = planned.placements.find((placement) => placement.mediaType === 'audio')
    const items = buildDroppedMediaTimelineItems({
      media,
      mediaId: media.id,
      mediaType,
      label: media.fileName,
      timelineFps: state.fps,
      blobUrl,
      thumbnailUrl: null,
      canvasWidth: project.metadata.width,
      canvasHeight: project.metadata.height,
      sourceStart: sourceRange?.sourceStart,
      sourceEnd: sourceRange?.sourceEnd,
      fallbackSourceFps: state.fps,
      placement: {
        primary: {
          trackId: primaryPlacement.trackId,
          from: primaryPlacement.from,
          durationInFrames: primaryPlacement.durationInFrames,
        },
        linkedAudio: linkedAudioPlacement
          ? {
              trackId: linkedAudioPlacement.trackId,
              from: linkedAudioPlacement.from,
              durationInFrames: linkedAudioPlacement.durationInFrames,
            }
          : undefined,
      },
      linkVideoAudio: planned.linkVideoAudio,
    })

    if (workingTracks !== state.tracks) state.setTracks(workingTracks)
    state.addItems(items)
    return saveTimelineEdit('添加素材到时间轴', {
      mediaId: media.id,
      fileName: media.fileName,
      requestedStartSeconds: args.startSeconds,
      actualStartSeconds: roundSeconds(primaryPlacement.from, state.fps),
      trackId: primaryPlacement.trackId,
      itemIds: items.map((item) => item.id),
      ...(sourceRange
        ? {
            sourceRange: {
              startSeconds: sourceRange.startSeconds,
              endSeconds: sourceRange.endSeconds,
              sourceStart: sourceRange.sourceStart,
              sourceEnd: sourceRange.sourceEnd,
            },
          }
        : {}),
    }, beforeSnapshot, signal)
  },
})

const timelineRemove = tool({
  name: 'timeline.remove',
  description: '删除一个或多个片段，并由编辑器同时清理相关转场、关键帧和成对音视频引用。',
  inputSchema: schema({ itemIds: { type: 'array', minItems: 1, maxItems: MAX_EDIT_ITEMS, items: { type: 'string' } } }, ['itemIds']),
  schema: z.object({ itemIds: z.array(z.string().min(1)).min(1).max(MAX_EDIT_ITEMS) }),
  execute: async (args, signal) => {
    const state = timeline()
    const before = args.itemIds.map((itemId) => itemSummary(requireItem(itemId), state.tracks, state.fps))
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()
    state.removeItems(args.itemIds)
    const remaining = new Set(state.items.map((item) => item.id))
    if (before.every((item) => remaining.has(String(item.id)))) throw new Error('没有删除任何片段。')
    return saveTimelineEdit('删除片段', { items: before }, beforeSnapshot, signal)
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
  execute: async (args, signal) => saveItemEdit('修改片段参数', args.itemId, (item) => {
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
  }, signal),
})

const timelineSetTransform = tool({
  name: 'timeline.set_transform',
  description: '修改片段画面变换。x/y 是画布内中心点的 0 到 1 归一化坐标（0.5 表示居中）；width/height 是占画布的 0 到 1 比例；cornerRadius 是相对画布短边的 0 到 1 比例。旋转使用角度，透明度使用 0 到 1。',
  inputSchema: schema({
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
  }, ['itemId']),
  schema: z.object({
    itemId: z.string().min(1),
    x: z.number().min(0).max(1).optional(),
    y: z.number().min(0).max(1).optional(),
    width: z.number().positive().max(1).optional(),
    height: z.number().positive().max(1).optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    flipHorizontal: z.boolean().optional(),
    flipVertical: z.boolean().optional(),
    cornerRadius: z.number().min(0).max(1).optional(),
  }).refine((args) => Object.entries(args).some(([key, value]) => key !== 'itemId' && value !== undefined), { message: '至少提供一个变换参数' }),
  execute: async (args, signal) => {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    signal?.throwIfAborted()
    return saveItemEdit('修改画面变换', args.itemId, (item) => {
      if (item.type === 'audio' || item.type === 'adjustment') throw new Error('该片段类型没有可修改的画面变换。')
      const { itemId, x, y, width, height, cornerRadius, ...transform } = args
      timeline().updateItemTransform(itemId, {
        ...transform,
        ...(x !== undefined ? { x: (x - 0.5) * project.metadata.width } : {}),
        ...(y !== undefined ? { y: (y - 0.5) * project.metadata.height } : {}),
        ...(width !== undefined ? { width: width * project.metadata.width } : {}),
        ...(height !== undefined ? { height: height * project.metadata.height } : {}),
        ...(cornerRadius !== undefined
          ? { cornerRadius: cornerRadius * Math.min(project.metadata.width, project.metadata.height) }
          : {}),
      })
    }, signal)
  },
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
  execute: async (args, signal) => saveItemEdit('修改音频参数', args.itemId, (item) => {
    if (item.type !== 'audio' && item.type !== 'video') throw new Error('只有视频或音频片段可以修改音频参数。')
    timeline().updateItem(item.id, {
      ...(args.volume !== undefined ? { volume: args.volume } : {}),
      ...(args.fadeIn !== undefined ? { audioFadeIn: args.fadeIn } : {}),
      ...(args.fadeOut !== undefined ? { audioFadeOut: args.fadeOut } : {}),
      ...(args.pitchSemitones !== undefined ? { audioPitchSemitones: args.pitchSemitones } : {}),
    })
  }, signal),
})

const timelineAddText = tool({
  name: 'timeline.add_text',
  description: '在时间轴顶部新增一条文字图层。时间单位是秒；优先放入按轨道顺序最近的空闲字幕轨道，所有字幕轨道都冲突或不存在时才创建新的字幕轨道。',
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
  execute: async (args, signal) => {
    const state = timeline()
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()
    const preset = args.stylePresetId
      ? TEXT_STYLE_PRESETS.find((candidate) => candidate.id === args.stylePresetId)
      : undefined
    if (args.stylePresetId && !preset) throw new Error(`没有找到文字样式 ${args.stylePresetId}。`)
    const from = secondsToFrame(args.startSeconds, state.fps)
    const durationInFrames = Math.max(1, secondsToFrame(args.durationSeconds, state.fps))
    const to = from + durationInFrames
    const track = state.tracks
      .filter((candidate) => !candidate.isGroup && !candidate.locked && getTrackKind(candidate) === 'subtitle')
      .toSorted((left, right) => left.order - right.order)
      .find((candidate) => !state.items.some((item) =>
        item.trackId === candidate.id &&
        item.from < to &&
        item.from + item.durationInFrames > from,
      ))
    const nextTracks = track
      ? state.tracks
      : (() => {
          const minOrder = state.tracks.reduce((lowest, candidate) => Math.min(lowest, candidate.order), 0)
          const newTrack = createClassicTrack({ tracks: state.tracks, kind: 'subtitle', order: minOrder - 1 })
          return [...state.tracks, newTrack]
        })()
    const targetTrack = track ?? nextTracks[nextTracks.length - 1]!
    const baseItem = createTextTemplateItem({
      placement: {
        trackId: targetTrack.id,
        from,
        durationInFrames,
        canvasWidth: project.metadata.width,
        canvasHeight: project.metadata.height,
        fps: state.fps,
      },
      label: args.label ?? preset?.label,
      text: args.text,
      textStylePresetId: args.stylePresetId as TextStylePresetId | undefined,
    })
    const item = args.stylePresetId
      ? baseItem
      : {
          ...baseItem,
          backgroundColor: 'rgba(0, 0, 0, 0.55)',
          backgroundRadius: 4,
          textPadding: 12,
          verticalAlign: 'middle' as const,
          transform: {
            ...baseItem.transform,
            y: Math.round(project.metadata.height * 0.36),
            width: Math.round(project.metadata.width * 0.7),
            height: Math.round(project.metadata.height * 0.16),
          },
        }
    if (track) state.addItem(item)
    else state.addItemOnNewTrack(item, nextTracks)
    return saveTimelineEdit('添加文字图层', { item: itemSummary(item, nextTracks, state.fps) }, beforeSnapshot, signal)
  },
})

const timelineAddKeyframe = tool({
  name: 'timeline.add_keyframe',
  description: '为片段增加一个标量关键帧。atSeconds 是相对片段起点的时间。x/y/width/height/anchorX/anchorY/cornerRadius、crop 边界和柔化、fontSize/textPadding/textShadowOffsetX/textShadowOffsetY/textShadowBlur/strokeWidth、trimPathStart/trimPathEnd 和 taper 属性的 value 统一使用 0 到 1 的归一化值，不要传入像素；x/y 的 0.5 表示居中，文字阴影偏移的 0.5 表示无偏移。trimPathOffset 是 -360 到 360 的角度。crop 相对于素材源尺寸，文字和描边尺寸相对于画布短边。旋转使用角度，透明度使用 0 到 1，行高和文字样式缩放使用倍数，音量使用 dB。',
  inputSchema: schema({
    itemId: { type: 'string' },
    property: { type: 'string', enum: ANIMATABLE_PROPERTIES },
    atSeconds: { type: 'number', minimum: 0 },
    value: { type: 'number', description: '空间、尺寸、文字、描边、裁剪和 trimPath/taper 比例属性使用 0 到 1；trimPathOffset 使用 -360 到 360 的角度；不要传入像素。x/y 与文字阴影偏移的 0.5 表示中心/无偏移。' },
    easing: { type: 'string', enum: EASING_TYPES },
  }, ['itemId', 'property', 'atSeconds', 'value']),
  schema: z.object({
    itemId: z.string().min(1),
    property: z.enum(ANIMATABLE_PROPERTIES),
    atSeconds: z.number().min(0),
    value: z.number(),
    easing: z.enum(EASING_TYPES).optional(),
  }).superRefine((args, context) => {
    if (NORMALIZED_KEYFRAME_PROPERTIES.has(args.property) && (args.value < 0 || args.value > 1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${args.property} 的关键帧值必须在 0 到 1 之间` })
    }
    if (args.property === 'trimPathOffset' && (args.value < -360 || args.value > 360)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'trimPathOffset 的关键帧值必须在 -360 到 360 度之间' })
    }
  }),
  execute: async (args, signal) => {
    const state = timeline()
    const item = requireItem(args.itemId)
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('当前没有打开的剪辑项目。')
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()
    const frame = secondsToFrame(args.atSeconds, state.fps)
    if (frame >= item.durationInFrames) throw new Error('关键帧时间必须位于片段内部。')
    const value = NORMALIZED_KEYFRAME_PROPERTIES.has(args.property)
      ? convertNormalizedKeyframeValue(args.property, args.value, item, project)
      : args.value
    const keyframeId = state.addKeyframe(
      item.id,
      args.property as AnimatableProperty,
      frame,
      value,
      args.easing as EasingType | undefined,
    )
    if (!keyframeId) throw new Error('关键帧没有成功创建，可能已经存在相同时间点的关键帧。')
    return saveTimelineEdit('添加关键帧', { itemId: item.id, property: args.property, atSeconds: args.atSeconds, value: args.value }, beforeSnapshot, signal)
  },
})

const timelineAddTransition = tool({
  name: 'timeline.add_transition',
  description: '在同一轨道上相邻的两个片段之间添加转场。presentation 必须是已注册的转场预设，默认使用 fade；需要方向的预设可传 direction，durationSeconds 使用秒。先调用 timeline.list_transitions 查看可用预设。',
  inputSchema: schema({
    leftItemId: { type: 'string' },
    rightItemId: { type: 'string' },
    durationSeconds: { type: 'number', exclusiveMinimum: 0 },
    presentation: { type: 'string', minLength: 1, maxLength: 100 },
    direction: { type: 'string', enum: TRANSITION_DIRECTIONS },
    alignment: { type: 'number', minimum: 0, maximum: 1 },
  }, ['leftItemId', 'rightItemId']),
  schema: z.object({
    leftItemId: z.string().min(1),
    rightItemId: z.string().min(1),
    durationSeconds: z.number().positive().optional(),
    presentation: z.string().trim().min(1).max(100).optional(),
    direction: z.enum(TRANSITION_DIRECTIONS).optional(),
    alignment: z.number().min(0).max(1).optional(),
  }),
  execute: async (args, signal) => {
    const state = timeline()
    const left = requireItem(args.leftItemId)
    const right = requireItem(args.rightItemId)
    const beforeSnapshot = captureSnapshot()
    signal?.throwIfAborted()
    if (left.trackId !== right.trackId) throw new Error('转场两侧的片段必须位于同一轨道。')
    const presentation = args.presentation ?? 'fade'
    const definition = transitionRegistry.getDefinition(presentation)
    if (!definition) throw new Error(`没有找到已注册的转场预设 ${presentation}。请先调用 timeline.list_transitions。`)
    if (args.direction && !definition.hasDirection) {
      throw new Error(`转场预设 ${presentation} 不支持方向参数。`)
    }
    if (args.direction && !definition.directions?.includes(args.direction)) {
      throw new Error(`转场预设 ${presentation} 不支持方向 ${args.direction}。`)
    }
    const added = state.addTransition(
      left.id,
      right.id,
      'crossfade',
      args.durationSeconds === undefined ? undefined : secondsToFrame(args.durationSeconds, state.fps),
      presentation as TransitionPresentation,
      args.direction,
      args.alignment,
    )
    if (!added) throw new Error('转场无法添加，请确认两个片段相邻并且有足够的素材余量。')
    return saveTimelineEdit('添加转场', { leftItemId: left.id, rightItemId: right.id, presentation }, beforeSnapshot, signal)
  },
})

const timelineListTransitions = tool({
  name: 'timeline.list_transitions',
  description: '列出当前编辑器已注册且可渲染的转场预设、分类、方向和默认时长。添加转场前先用它确认 presentation 和 direction。',
  inputSchema: schema({}),
  schema: z.object({}),
  execute: async () => ({
    ok: true,
    message: `当前有 ${transitionRegistry.size} 个可用转场预设。`,
    data: {
      transitions: transitionRegistry.getDefinitions().map((definition) => ({
        id: definition.id,
        label: definition.label,
        description: definition.description,
        category: definition.category,
        hasDirection: definition.hasDirection,
        ...(definition.directions ? { directions: definition.directions } : {}),
        defaultDurationFrames: definition.defaultDuration,
        minDurationFrames: definition.minDuration,
        maxDurationFrames: definition.maxDuration,
      })),
    },
  }),
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
  projectSetCanvas,
  timelineInspectContext,
  timelineAddMedia,
  timelineTrim,
  timelineSplit,
  timelineMove,
  timelineRemove,
  timelineSetProperties,
  timelineSetTransform,
  timelineSetAudio,
  timelineAddText,
  timelineAddKeyframe,
  timelineListTransitions,
  timelineAddTransition,
  timelineValidate,
]
