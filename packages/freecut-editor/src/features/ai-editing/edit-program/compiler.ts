import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { resolveMediaUrl, useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import {
  createClassicTrack,
  createTextTemplateItem,
  getTrackKind,
} from '@freecut/features/editor/deps/timeline-contract'
import { buildMediaTimelineItems } from '@freecut/features/editor/deps/timeline-utils'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import type { TextItem, TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { clipRef, idFromAgentRef } from '../workspace-document/build-workspace-document'
import type {
  AgentClipDraft,
  AgentTransitionSpec,
  EditProgram,
  EditProgramDiff,
} from './types'
import { prepareHtmlInsert, prepareHtmlUpdate } from './html-compiler'
import { compileTextPresentation, prepareEditableTextItem } from './text-compiler'
import { compileVisualState } from './visual-compiler'

export { compileVisualState, transformForPose } from './visual-compiler'

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

function assertTrackCompatibility(
  trackId: string,
  type: 'video' | 'audio' | 'image' | 'text' | 'subtitle',
): void {
  const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId)
  if (!track || track.isGroup) throw new Error('编辑程序引用了不存在的轨道。')
  if (track.locked) throw new Error(`轨道“${track.name}”已锁定。`)
  const expected =
    type === 'audio' ? 'audio' : type === 'text' || type === 'subtitle' ? 'subtitle' : 'video'
  if (getTrackKind(track) !== expected) throw new Error(`素材不能放入轨道“${track.name}”。`)
}

export function resolveAiLinkedAudioPlacement(params: {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  from: number
  durationInFrames: number
}): { tracks: TimelineTrack[]; trackId: string } {
  const end = params.from + params.durationInFrames
  const reusableTrack = params.tracks
    .filter((track) => !track.isGroup && !track.locked && getTrackKind(track) === 'audio')
    .filter((track) =>
      params.items.every(
        (item) =>
          item.trackId !== track.id ||
          item.from + item.durationInFrames <= params.from ||
          item.from >= end,
      ),
    )
    .sort((left, right) => left.order - right.order)[0]

  if (reusableTrack) return { tracks: params.tracks, trackId: reusableTrack.id }

  const maxOrder = params.tracks.reduce((highest, track) => Math.max(highest, track.order), 0)
  const audioTrack = createClassicTrack({
    tracks: params.tracks,
    kind: 'audio',
    order: maxOrder + 1,
  })
  return { tracks: [...params.tracks, audioTrack], trackId: audioTrack.id }
}

async function prepareClipDraft(
  draft: AgentClipDraft,
  fps: number,
  canvas: { width: number; height: number },
  tracks: TimelineTrack[],
  items: TimelineItem[],
): Promise<{ items: TimelineItem[]; tracks: TimelineTrack[] }> {
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
  const from = secondsToFrames(draft.start, fps)
  const durationInFrames = Math.max(1, secondsToFrames(draft.duration, fps))
  let nextTracks = tracks
  let linkedAudioTrackId: string | undefined
  if (type === 'video' && media.audioCodec) {
    const audioPlacement = resolveAiLinkedAudioPlacement({
      tracks,
      items,
      from,
      durationInFrames,
    })
    nextTracks = audioPlacement.tracks
    linkedAudioTrackId = audioPlacement.trackId
  }

  const builtItems = buildMediaTimelineItems({
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
        from,
        durationInFrames,
      },
      ...(linkedAudioTrackId
        ? { linkedAudio: { trackId: linkedAudioTrackId, from, durationInFrames } }
        : {}),
    },
    linkVideoAudio: linkedAudioTrackId !== undefined,
    sourceStart,
    sourceEnd,
  })
  const item = builtItems[0]
  if (!item) throw new Error('无法创建时间线片段。')
  const sourceSpan = draft.source ? draft.source.out - draft.source.in : undefined
  if (sourceSpan !== undefined && type !== 'image') {
    const speed = Math.max(0.1, Math.min(10, sourceSpan / draft.duration))
    for (const builtItem of builtItems) builtItem.speed = speed
  }
  Object.assign(item, compileVisualState({
    item,
    framing: draft.framing,
    cameraMove: draft.cameraMove,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
  }))
  return { items: builtItems, tracks: nextTracks }
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
    const prepared = await prepareClipDraft(draft, fps, canvas, virtualTracks, virtualItems)
    const item = prepared.items[0]
    if (!item) throw new Error('无法创建时间线片段。')
    virtualTracks = prepared.tracks
    refs.set(draft.ref, item.id)
    insertItems.push(...prepared.items)
    virtualItems.push(...prepared.items)
    for (const preparedItem of prepared.items) touchedIds.add(preparedItem.id)
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
        if (item.linkedGroupId) {
          for (const linkedItem of virtualItems) {
            if (linkedItem.linkedGroupId !== item.linkedGroupId) continue
            removeIds.add(linkedItem.id)
            touchedIds.add(linkedItem.id)
          }
        }
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
      const startFrame = secondsToFrames(operation.text.start, fps)
      const durationInFrames = Math.max(1, secondsToFrames(operation.text.duration, fps))
      let textTrackId: string
      if (operation.text.trackRef) {
        textTrackId = idFromAgentRef(operation.text.trackRef, 'track')
        assertTrackCompatibility(textTrackId, 'text')
      } else {
        const endFrame = startFrame + durationInFrames
        const reusableTrack = virtualTracks
          .filter(
            (track) =>
              !track.isGroup &&
              !track.locked &&
              track.visible !== false &&
              getTrackKind(track) === 'subtitle',
          )
          .find((track) =>
            virtualItems.every(
              (item) =>
                item.trackId !== track.id ||
                item.from + item.durationInFrames <= startFrame ||
                item.from >= endFrame,
            ),
          )
        if (reusableTrack) {
          textTrackId = reusableTrack.id
        } else {
          const minOrder = virtualTracks.reduce(
            (lowest, track) => Math.min(lowest, track.order),
            0,
          )
          const textTrack = createClassicTrack({
            tracks: virtualTracks,
            kind: 'subtitle',
            order: minOrder - 1,
          })
          virtualTracks = [...virtualTracks, textTrack]
          textTrackId = textTrack.id
        }
      }
      const textItem = createTextTemplateItem({
        placement: {
          trackId: textTrackId,
          from: startFrame,
          durationInFrames,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          fps,
        },
        text: operation.text.text,
        label: operation.text.label ?? operation.text.text.slice(0, 40),
        ...(operation.text.role !== 'caption' ? { textStylePresetId: 'clean-title' } : {}),
      })
      Object.assign(textItem, compileTextPresentation({
        item: textItem,
        style: operation.text.style,
        spans: operation.text.spans,
        box: operation.text.box,
        canvas,
      }))
      const insertedTextItem: TimelineItem = operation.text.role === 'caption'
        ? { ...textItem, textRole: 'caption' }
        : textItem
      refs.set(operation.text.ref, insertedTextItem.id)
      insertItems.push(insertedTextItem)
      virtualItems.push(insertedTextItem)
      touchedIds.add(insertedTextItem.id)
      changedRanges.push({
        start: operation.text.start,
        end: operation.text.start + operation.text.duration,
      })
      continue
    }

    if (operation.type === 'insertHtml') {
      if (refs.has(operation.html.ref)) {
        throw new Error(`编辑程序中的片段引用“${operation.html.ref}”重复。`)
      }
      const prepared = prepareHtmlInsert({
        draft: operation.html,
        fps,
        canvas,
        tracks: virtualTracks,
        items: virtualItems,
      })
      const htmlItem = prepared.item
      virtualTracks = prepared.tracks
      refs.set(operation.html.ref, htmlItem.id)
      insertItems.push(htmlItem)
      virtualItems.push(htmlItem)
      touchedIds.add(htmlItem.id)
      changedRanges.push({
        start: operation.html.start,
        end: operation.html.start + operation.html.duration,
      })
      continue
    }

    if (operation.type === 'updateHtml') {
      const id = resolveClipId(operation.clipRef)
      const item = virtualItems.find((candidate) => candidate.id === id)
      if (!item) throw new Error(`片段“${operation.clipRef}”已经被移除。`)
      const prepared = prepareHtmlUpdate(item, operation)
      const merged = prepared.item
      virtualItems = virtualItems.map((candidate) => candidate.id === id ? merged : candidate)
      updates.set(id, { ...updates.get(id), ...prepared.updates } as Partial<TimelineItem>)
      touchedIds.add(id)
      changedRanges.push({
        start: item.from / fps,
        end: (item.from + item.durationInFrames) / fps,
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
      const compatibilityType =
        item.type === 'audio' || item.type === 'text' || item.type === 'subtitle'
          ? item.type
          : 'video'
      assertTrackCompatibility(nextTrackId, compatibilityType)
      const next: Partial<TimelineItem> = {
        ...(operation.changes.start !== undefined ? { from: secondsToFrames(operation.changes.start, fps) } : {}),
        ...(operation.changes.duration !== undefined
          ? { durationInFrames: Math.max(1, secondsToFrames(operation.changes.duration, fps)) }
          : {}),
        ...(operation.changes.trackRef ? { trackId: nextTrackId } : {}),
        ...(operation.changes.label ? { label: operation.changes.label } : {}),
        ...(operation.changes.volumeDb !== undefined ? { volume: operation.changes.volumeDb } : {}),
      }
      const hasTextChanges =
        operation.changes.text !== undefined ||
        operation.changes.textStyle !== undefined ||
        operation.changes.textSpans !== undefined ||
        operation.changes.textBox !== undefined
      const editableText = hasTextChanges ? prepareEditableTextItem(item) : null
      if (hasTextChanges && !editableText) {
        throw new Error('只有普通文字或单句手动字幕可以修改文字内容和样式。')
      }
      if (editableText) Object.assign(next, editableText.conversion)
      if (operation.changes.text !== undefined) {
        Object.assign(next, { text: operation.changes.text, textSpans: undefined, spanLayout: undefined })
      }
      if (
        operation.changes.textStyle !== undefined ||
        operation.changes.textSpans !== undefined ||
        operation.changes.textBox !== undefined
      ) {
        Object.assign(next, compileTextPresentation({
          item: { ...editableText!.item, ...next } as TextItem,
          style: operation.changes.textStyle,
          spans: operation.changes.textSpans,
          box: operation.changes.textBox,
          canvas,
        }))
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
