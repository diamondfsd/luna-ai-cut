import {
  createClassicTrack,
  getTrackKind,
} from '@freecut/features/editor/deps/timeline-contract'
import type { HtmlItem, TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { idFromAgentRef } from '../workspace-document/build-workspace-document'
import { assertValidHtmlSource } from './html-source'
import type { AgentHtmlDraft, EditOperation } from './types'

type UpdateHtmlOperation = Extract<EditOperation, { type: 'updateHtml' }>

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(0, Math.round(seconds * fps))
}

function assertHtmlTrack(trackId: string, tracks: TimelineTrack[]): void {
  const track = tracks.find((candidate) => candidate.id === trackId)
  if (!track || track.isGroup) throw new Error('编辑程序引用了不存在的轨道。')
  if (track.locked) throw new Error(`轨道“${track.name}”已锁定。`)
  if (getTrackKind(track) !== 'video') throw new Error(`HTML 视觉不能放入轨道“${track.name}”。`)
}

function resolveHtmlTrackPlacement(params: {
  requestedTrackRef?: string
  tracks: TimelineTrack[]
  items: TimelineItem[]
  from: number
  durationInFrames: number
}): { tracks: TimelineTrack[]; trackId: string } {
  if (params.requestedTrackRef) {
    const trackId = idFromAgentRef(params.requestedTrackRef, 'track')
    assertHtmlTrack(trackId, params.tracks)
    return { tracks: params.tracks, trackId }
  }

  const end = params.from + params.durationInFrames
  const reusableTrack = params.tracks
    .filter((track) => !track.isGroup && !track.locked && track.visible !== false && getTrackKind(track) === 'video')
    .filter((track) => params.items.every((item) =>
      item.trackId !== track.id || item.from + item.durationInFrames <= params.from || item.from >= end,
    ))
    .sort((left, right) => left.order - right.order)[0]
  if (reusableTrack) return { tracks: params.tracks, trackId: reusableTrack.id }

  const minOrder = params.tracks.reduce((lowest, track) => Math.min(lowest, track.order), 0)
  const htmlTrack = createClassicTrack({ tracks: params.tracks, kind: 'video', order: minOrder - 1 })
  return { tracks: [...params.tracks, htmlTrack], trackId: htmlTrack.id }
}

export function prepareHtmlInsert(params: {
  draft: AgentHtmlDraft
  fps: number
  canvas: { width: number; height: number }
  tracks: TimelineTrack[]
  items: TimelineItem[]
}): { item: HtmlItem; tracks: TimelineTrack[] } {
  const from = secondsToFrames(params.draft.start, params.fps)
  const durationInFrames = Math.max(1, secondsToFrames(params.draft.duration, params.fps))
  const viewport = params.draft.viewport ?? {
    width: params.canvas.width,
    height: params.canvas.height,
    deviceScaleFactor: 1,
  }
  assertValidHtmlSource({ html: params.draft.html, css: params.draft.css, viewport })
  const placement = resolveHtmlTrackPlacement({
    requestedTrackRef: params.draft.trackRef,
    tracks: params.tracks,
    items: params.items,
    from,
    durationInFrames,
  })
  return {
    item: {
      id: crypto.randomUUID(),
      type: 'html',
      trackId: placement.trackId,
      from,
      durationInFrames,
      label: params.draft.label ?? 'HTML 视觉',
      html: params.draft.html,
      css: params.draft.css,
      viewport,
      renderMode: params.draft.renderMode ?? 'static',
      sourceRevision: 1,
      assets: [],
    },
    tracks: placement.tracks,
  }
}

export function prepareHtmlUpdate(
  item: TimelineItem,
  operation: UpdateHtmlOperation,
): { item: HtmlItem; updates: Partial<HtmlItem> } {
  if (item.type !== 'html') throw new Error('只有 HTML 片段可以修改 HTML/CSS 源码。')
  if (item.sourceRevision !== operation.expectedRevision) {
    throw new Error('HTML 片段源码已经变化，请重新读取后再修改。')
  }
  assertValidHtmlSource({
    html: operation.changes.html ?? item.html,
    css: operation.changes.css ?? item.css,
    viewport: operation.changes.viewport ?? item.viewport,
  })
  const updates: Partial<HtmlItem> = {
    ...operation.changes,
    sourceRevision: item.sourceRevision + 1,
  }
  return { item: { ...item, ...updates }, updates }
}
