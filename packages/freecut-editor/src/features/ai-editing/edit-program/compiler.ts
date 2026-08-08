import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { resolveMediaUrl, useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import {
  createOverlayLayerTrack,
  createTextTemplateItem,
  getTrackKind,
} from '@freecut/features/editor/deps/timeline-contract'
import { buildMediaTimelineItems } from '@freecut/features/editor/deps/timeline-utils'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import type { EasingType } from '@freecut/types/keyframe'
import type { MotionAnimationLayer, MotionLayerTrack } from '@freecut/types/motion'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import type { TransformProperties } from '@freecut/types/transform'
import { clipRef, idFromAgentRef } from '../workspace-document/build-workspace-document'
import type {
  AgentCameraMove,
  AgentClipDraft,
  AgentFraming,
  AgentFramingPose,
  AgentTransitionSpec,
  EditProgram,
  EditProgramDiff,
} from './types'

interface CompiledTransition {
  between: [string, string]
  draft: AgentTransitionSpec | null
}

export interface CompiledEditProgram {
  program: EditProgram
  removeIds: string[]
  insertItems: TimelineItem[]
  tracks: TimelineTrack[]
  updates: Array<{ id: string; updates: Partial<TimelineItem> }>
  transitions: CompiledTransition[]
  diff: EditProgramDiff
  warnings: string[]
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

function mediaType(mimeType: string): 'video' | 'audio' | 'image' | null {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  return null
}

function easing(value: AgentCameraMove['easing']): EasingType {
  return value ?? 'ease-in-out'
}

export function transformForPose(params: {
  pose: AgentFramingPose
  mode: AgentFraming['mode']
  sourceWidth: number
  sourceHeight: number
  canvasWidth: number
  canvasHeight: number
}): Required<Pick<TransformProperties, 'x' | 'y' | 'width' | 'height' | 'rotation'>> {
  const scale = params.mode === 'cover'
    ? Math.max(params.canvasWidth / params.sourceWidth, params.canvasHeight / params.sourceHeight)
    : Math.min(params.canvasWidth / params.sourceWidth, params.canvasHeight / params.sourceHeight)
  const width = params.sourceWidth * scale * params.pose.zoom
  const height = params.sourceHeight * scale * params.pose.zoom
  return {
    x: (0.5 - params.pose.center[0]) * width,
    y: (0.5 - params.pose.center[1]) * height,
    width,
    height,
    rotation: params.pose.rotation ?? 0,
  }
}

function motionTrack(
  property: MotionLayerTrack['property'],
  blend: MotionLayerTrack['blend'],
  endFrame: number,
  endValue: number,
  motionEasing: EasingType,
): MotionLayerTrack {
  return {
    property,
    blend,
    keyframes: [
      { id: crypto.randomUUID(), frame: 0, value: blend === 'multiply' ? 1 : 0, easing: motionEasing },
      { id: crypto.randomUUID(), frame: endFrame, value: endValue, easing: motionEasing },
    ],
  }
}

export function compileVisualState(params: {
  item: TimelineItem
  framing?: AgentFraming
  cameraMove?: AgentCameraMove | null
  canvasWidth: number
  canvasHeight: number
}): Partial<TimelineItem> {
  if (params.item.type !== 'video' && params.item.type !== 'image') {
    if (params.framing || params.cameraMove) throw new Error('只有画面片段可以设置取景和运镜。')
    return {}
  }
  const sourceWidth = params.item.sourceWidth ?? params.canvasWidth
  const sourceHeight = params.item.sourceHeight ?? params.canvasHeight
  const mode = params.framing?.mode ?? 'cover'
  const startPose = params.cameraMove?.from ?? params.framing?.pose
  const transform = startPose
    ? transformForPose({
        pose: startPose,
        mode,
        sourceWidth,
        sourceHeight,
        canvasWidth: params.canvasWidth,
        canvasHeight: params.canvasHeight,
      })
    : params.item.transform

  const retainedLayers = (params.item.motionLayers ?? [])
    .filter((layer) => layer.sourcePresetId !== 'ai-edit-program')
  if (!params.cameraMove) {
    return {
      ...(transform ? { transform } : {}),
      ...(params.cameraMove === null ? { motionLayers: retainedLayers } : {}),
    }
  }

  const start = transformForPose({
    pose: params.cameraMove.from,
    mode,
    sourceWidth,
    sourceHeight,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
  })
  const end = transformForPose({
    pose: params.cameraMove.to,
    mode,
    sourceWidth,
    sourceHeight,
    canvasWidth: params.canvasWidth,
    canvasHeight: params.canvasHeight,
  })
  const endFrame = Math.max(1, params.item.durationInFrames - 1)
  const motionEasing = easing(params.cameraMove.easing)
  const layer: MotionAnimationLayer = {
    id: crypto.randomUUID(),
    name: 'AI 运镜',
    enabled: true,
    source: 'built-in-preset',
    sourcePresetId: 'ai-edit-program',
    tracks: [
      motionTrack('x', 'add', endFrame, end.x - start.x, motionEasing),
      motionTrack('y', 'add', endFrame, end.y - start.y, motionEasing),
      motionTrack('width', 'multiply', endFrame, end.width / start.width, motionEasing),
      motionTrack('height', 'multiply', endFrame, end.height / start.height, motionEasing),
      motionTrack('rotation', 'add', endFrame, end.rotation - start.rotation, motionEasing),
    ],
  }
  return { transform: start, motionLayers: [...retainedLayers, layer] }
}

function assertTrackCompatibility(trackId: string, type: 'video' | 'audio' | 'image'): void {
  const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId)
  if (!track || track.isGroup) throw new Error('编辑程序引用了不存在的轨道。')
  if (track.locked) throw new Error(`轨道“${track.name}”已锁定。`)
  const expected = type === 'audio' ? 'audio' : 'video'
  if (getTrackKind(track) !== expected) throw new Error(`素材不能放入轨道“${track.name}”。`)
}

async function prepareClipDraft(
  draft: AgentClipDraft,
  fps: number,
  canvas: { width: number; height: number },
): Promise<TimelineItem> {
  const mediaId = idFromAgentRef(draft.mediaRef, 'media')
  const trackId = idFromAgentRef(draft.trackRef, 'track')
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) throw new Error(`素材“${draft.mediaRef}”已不在素材库中。`)
  const type = mediaType(media.mimeType)
  if (!type) throw new Error(`素材“${media.fileName}”暂不支持编辑程序。`)
  assertTrackCompatibility(trackId, type)
  if (draft.source && type !== 'image' && draft.source.out > media.duration + 0.001) {
    throw new Error(`素材“${media.fileName}”的选段超出素材时长。`)
  }
  const blobUrl = await resolveMediaUrl(mediaId)
  if (!blobUrl) throw new Error(`无法读取素材“${media.fileName}”。`)
  const sourceFps = media.fps > 0 ? media.fps : fps
  const sourceStart = secondsToFrames(draft.source?.in ?? 0, sourceFps)
  const sourceEnd = draft.source
    ? secondsToFrames(draft.source.out, sourceFps)
    : undefined
  const [item] = buildMediaTimelineItems({
    media,
    mediaId,
    mediaType: type,
    label: draft.label ?? media.fileName,
    projectFps: fps,
    blobUrl,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    placements: {
      primary: {
        trackId,
        from: secondsToFrames(draft.start, fps),
        durationInFrames: Math.max(1, secondsToFrames(draft.duration, fps)),
      },
    },
    sourceStart,
    sourceEnd,
  })
  if (!item) throw new Error('无法创建时间线片段。')
  const sourceSpan = draft.source ? draft.source.out - draft.source.in : undefined
  if (sourceSpan !== undefined && type !== 'image') {
    item.speed = Math.max(0.1, Math.min(10, sourceSpan / draft.duration))
  }
  Object.assign(item, compileVisualState({
    item,
    framing: draft.framing,
    cameraMove: draft.cameraMove,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  }))
  return item
}

function assertNoCollisions(items: TimelineItem[], touchedIds: Set<string>): void {
  const sorted = items.toSorted((left, right) => left.trackId.localeCompare(right.trackId) || left.from - right.from)
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1]!
    const right = sorted[index]!
    if (left.trackId !== right.trackId) continue
    if (left.from + left.durationInFrames <= right.from) continue
    if (!touchedIds.has(left.id) && !touchedIds.has(right.id)) continue
    throw new Error(`片段“${left.label}”与“${right.label}”在同一轨道发生重叠。`)
  }
}

export async function compileEditProgram(program: EditProgram): Promise<CompiledEditProgram> {
  const timeline = useTimelineStore.getState()
  if ((timeline.changeVersion ?? 0) !== program.baseRevision) {
    throw new Error('时间轴在生成编辑程序后已发生变化，请基于最新编辑空间重新生成。')
  }
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const metadata = useProjectStore.getState().currentProject?.metadata
  const canvas = {
    width: metadata?.width ?? DEFAULT_PROJECT_WIDTH,
    height: metadata?.height ?? DEFAULT_PROJECT_HEIGHT,
  }
  let virtualItems = [...timeline.items]
  let virtualTracks = [...timeline.tracks]
  const removeIds = new Set<string>()
  const insertItems: TimelineItem[] = []
  const updates = new Map<string, Partial<TimelineItem>>()
  const transitions: CompiledTransition[] = []
  const refs = new Map<string, string>(timeline.items.map((item) => [clipRef(item.id), item.id]))
  const touchedIds = new Set<string>()
  const changedRanges: EditProgramDiff['changedRanges'] = []

  const resolveClipId = (value: string): string => {
    const id = refs.get(value)
    if (!id) throw new Error(`没有找到片段引用“${value}”。`)
    return id
  }
  const appendDraft = async (draft: AgentClipDraft) => {
    if (refs.has(draft.ref)) throw new Error(`编辑程序中的片段引用“${draft.ref}”重复。`)
    const item = await prepareClipDraft(draft, fps, canvas)
    refs.set(draft.ref, item.id)
    insertItems.push(item)
    virtualItems.push(item)
    touchedIds.add(item.id)
  }

  for (const operation of program.operations) {
    if (operation.type === 'replaceRange') {
      const targetTracks = new Set(
        (operation.trackRefs ?? operation.clips.map((clip) => clip.trackRef))
          .map((value) => idFromAgentRef(value, 'track')),
      )
      const start = secondsToFrames(operation.range.start, fps)
      const end = secondsToFrames(operation.range.end, fps)
      for (const item of virtualItems) {
        if (!targetTracks.has(item.trackId)) continue
        if (item.from >= end || item.from + item.durationInFrames <= start) continue
        removeIds.add(item.id)
        touchedIds.add(item.id)
      }
      virtualItems = virtualItems.filter((item) => !removeIds.has(item.id))
      for (const draft of operation.clips) await appendDraft(draft)
      for (const transition of operation.transitions ?? []) {
        transitions.push({
          between: [resolveClipId(transition.between[0]), resolveClipId(transition.between[1])],
          draft: transition.transition,
        })
      }
      changedRanges.push(operation.range)
      continue
    }

    if (operation.type === 'insertClip') {
      await appendDraft(operation.clip)
      changedRanges.push({ start: operation.clip.start, end: operation.clip.start + operation.clip.duration })
      continue
    }

    if (operation.type === 'insertText') {
      if (refs.has(operation.text.ref)) {
        throw new Error(`编辑程序中的片段引用“${operation.text.ref}”重复。`)
      }
      let textTrackId: string
      if (operation.text.trackRef) {
        textTrackId = idFromAgentRef(operation.text.trackRef, 'track')
        assertTrackCompatibility(textTrackId, 'video')
      } else {
        const overlay = createOverlayLayerTrack({ tracks: virtualTracks, activeTrackId: null })
        if (!overlay) throw new Error('无法为文字创建画面轨道。')
        textTrackId = overlay.trackId
        virtualTracks = overlay.tracks
      }
      const textItem = createTextTemplateItem({
        placement: {
          trackId: textTrackId,
          from: secondsToFrames(operation.text.start, fps),
          durationInFrames: Math.max(1, secondsToFrames(operation.text.duration, fps)),
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          fps,
        },
        text: operation.text.text,
        label: operation.text.label ?? operation.text.text.slice(0, 40),
        ...(operation.text.role !== 'caption' ? { textStylePresetId: 'clean-title' } : {}),
      })
      refs.set(operation.text.ref, textItem.id)
      insertItems.push(textItem)
      virtualItems.push(textItem)
      touchedIds.add(textItem.id)
      changedRanges.push({
        start: operation.text.start,
        end: operation.text.start + operation.text.duration,
      })
      continue
    }

    if (operation.type === 'removeClip') {
      const id = resolveClipId(operation.clipRef)
      const item = virtualItems.find((candidate) => candidate.id === id)
      if (!item) throw new Error(`片段“${operation.clipRef}”已经被移除。`)
      removeIds.add(id)
      touchedIds.add(id)
      virtualItems = virtualItems.filter((candidate) => candidate.id !== id)
      changedRanges.push({ start: item.from / fps, end: (item.from + item.durationInFrames) / fps })
      continue
    }

    if (operation.type === 'updateClip') {
      const id = resolveClipId(operation.clipRef)
      const item = virtualItems.find((candidate) => candidate.id === id)
      if (!item) throw new Error(`片段“${operation.clipRef}”已经被移除。`)
      const nextTrackId = operation.changes.trackRef
        ? idFromAgentRef(operation.changes.trackRef, 'track')
        : item.trackId
      assertTrackCompatibility(nextTrackId, item.type === 'audio' ? 'audio' : 'video')
      const next: Partial<TimelineItem> = {
        ...(operation.changes.start !== undefined ? { from: secondsToFrames(operation.changes.start, fps) } : {}),
        ...(operation.changes.duration !== undefined
          ? { durationInFrames: Math.max(1, secondsToFrames(operation.changes.duration, fps)) }
          : {}),
        ...(operation.changes.trackRef ? { trackId: nextTrackId } : {}),
        ...(operation.changes.label ? { label: operation.changes.label } : {}),
        ...(operation.changes.volumeDb !== undefined ? { volume: operation.changes.volumeDb } : {}),
      }
      if (operation.changes.text !== undefined) {
        if (item.type !== 'text') throw new Error('只有文字片段可以修改文字内容。')
        Object.assign(next, { text: operation.changes.text })
      }
      const candidate = { ...item, ...next } as TimelineItem
      Object.assign(next, compileVisualState({
        item: candidate,
        framing: operation.changes.framing,
        cameraMove: operation.changes.cameraMove,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      }))
      const merged = { ...item, ...next } as TimelineItem
      virtualItems = virtualItems.map((candidateItem) => candidateItem.id === id ? merged : candidateItem)
      updates.set(id, { ...updates.get(id), ...next })
      touchedIds.add(id)
      changedRanges.push({
        start: Math.min(item.from, merged.from) / fps,
        end: Math.max(item.from + item.durationInFrames, merged.from + merged.durationInFrames) / fps,
      })
      continue
    }

    const between: [string, string] = [
      resolveClipId(operation.between[0]),
      resolveClipId(operation.between[1]),
    ]
    transitions.push({ between, draft: operation.transition })
  }

  assertNoCollisions(virtualItems, touchedIds)
  return {
    program,
    removeIds: [...removeIds],
    insertItems,
    tracks: virtualTracks,
    updates: [...updates].map(([id, itemUpdates]) => ({ id, updates: itemUpdates })),
    transitions,
    warnings: [],
    diff: {
      created: insertItems.map((item) => clipRef(item.id)),
      updated: [...updates.keys()].map(clipRef),
      removed: [...removeIds].map(clipRef),
      changedRanges,
      transitionsChanged: transitions.length,
    },
  }
}
