import { useMediaLibraryStore, resolveMediaUrl } from '@freecut/features/editor/deps/media-library'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import {
  addItemsOnNewTracks,
  buildMediaTimelineItems,
  getTrackKind,
  planTrackMediaDropPlacements,
} from '@freecut/features/editor/deps/timeline-utils'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import type { MediaMetadata } from '@freecut/types/storage'
import type { AiEditingToolResult } from './types'

type ComposableMediaType = 'video' | 'audio' | 'image' | 'lottie'

export interface MediaCompositionSelection {
  mediaId: string
  startSeconds?: number
  endSeconds?: number
}

export interface MediaCompositionRequest {
  selections: MediaCompositionSelection[]
  startSeconds?: number
  includeOriginalAudio: boolean
}

interface ResolvedSelection extends MediaCompositionSelection {
  media: MediaMetadata
  mediaType: ComposableMediaType
  sourceStart: number
  sourceEnd: number
  durationInFrames: number
}

function getComposableMediaType(mimeType: string): ComposableMediaType | null {
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.includes('lottie') || mimeType === 'application/json') return 'lottie'
  return null
}

function resolveSourceRange(
  media: MediaMetadata,
  mediaType: ComposableMediaType,
  selection: MediaCompositionSelection,
  timelineFps: number,
): Omit<ResolvedSelection, 'media' | 'mediaType' | 'mediaId' | 'startSeconds' | 'endSeconds'> | null {
  const sourceFps = media.fps && media.fps > 0 ? media.fps : timelineFps
  const sourceDurationSeconds = mediaType === 'image' ? Math.max(media.duration, 3) : media.duration
  const totalSourceFrames = Math.max(1, Math.round(sourceDurationSeconds * sourceFps))
  const sourceStart = Math.min(totalSourceFrames - 1, Math.round((selection.startSeconds ?? 0) * sourceFps))
  const sourceEnd = Math.min(
    totalSourceFrames,
    Math.round((selection.endSeconds ?? sourceDurationSeconds) * sourceFps),
  )
  if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd <= sourceStart) return null

  return {
    sourceStart,
    sourceEnd,
    durationInFrames: Math.max(1, Math.round(((sourceEnd - sourceStart) * timelineFps) / sourceFps)),
  }
}

function resolveSelections(request: MediaCompositionRequest, timelineFps: number): {
  selections: ResolvedSelection[]
  error?: string
} {
  const mediaById = useMediaLibraryStore.getState().mediaById
  const selections: ResolvedSelection[] = []

  for (const selection of request.selections) {
    const media = mediaById[selection.mediaId]
    if (!media) return { selections: [], error: '有素材已不在素材库中，请重新生成剪辑计划。' }

    const mediaType = getComposableMediaType(media.mimeType)
    if (!mediaType) return { selections: [], error: `素材“${media.fileName}”暂不支持加入时间轴。` }

    const range = resolveSourceRange(media, mediaType, selection, timelineFps)
    if (!range) return { selections: [], error: `素材“${media.fileName}”的选段时间无效。` }

    selections.push({ ...selection, media, mediaType, ...range })
  }

  return { selections }
}

function timelineEndFrame(): number {
  return useTimelineStore.getState().items.reduce(
    (endFrame, item) => Math.max(endFrame, item.from + item.durationInFrames),
    0,
  )
}

/**
 * Turns model-selected library ranges into the same linked video/audio items
 * used by a regular media-library drop. Existing timeline content is kept and
 * the sequence is appended by default.
 */
export async function composeTimelineFromMedia(
  request: MediaCompositionRequest,
): Promise<AiEditingToolResult> {
  const timeline = useTimelineStore.getState()
  const fps = timeline.fps > 0 ? timeline.fps : 30
  const resolved = resolveSelections(request, fps)
  if (resolved.error) return { ok: false, message: resolved.error }

  const preferredKind = resolved.selections.every((selection) => selection.mediaType === 'audio')
    ? 'audio'
    : 'video'
  const targetTrack = timeline.tracks.find(
    (track) => !track.isGroup && !track.locked && getTrackKind(track) === preferredKind,
  )
  if (!targetTrack) return { ok: false, message: '时间轴中没有可放置素材的轨道。' }

  const startFrame = Math.round((request.startSeconds ?? timelineEndFrame() / fps) * fps)
  const { plannedItems, tracks } = planTrackMediaDropPlacements({
    entries: resolved.selections.map((selection) => ({
      payload: selection,
      label: selection.media.fileName,
      mediaType: selection.mediaType,
      durationInFrames: selection.durationInFrames,
      hasLinkedAudio:
        request.includeOriginalAudio && selection.mediaType === 'video' && Boolean(selection.media.audioCodec),
    })),
    dropFrame: Math.max(0, startFrame),
    tracks: timeline.tracks,
    existingItems: timeline.items,
    dropTargetTrackId: targetTrack.id,
  })
  if (plannedItems.length !== resolved.selections.length) {
    return { ok: false, message: '部分素材无法放入当前时间轴，请重新生成剪辑计划。' }
  }

  const project = useProjectStore.getState().currentProject
  const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
  const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
  const expectedRevision = timeline.changeVersion ?? 0
  const items = []

  for (const planned of plannedItems) {
    const selection = planned.entry.payload
    const blobUrl = await resolveMediaUrl(selection.mediaId)
    if (!blobUrl) return { ok: false, message: `无法读取素材“${selection.media.fileName}”。` }

    const primaryPlacement = planned.placements.find((placement) => placement.mediaType !== 'audio')
      ?? planned.placements[0]
    if (!primaryPlacement) return { ok: false, message: '无法确定素材在时间轴中的位置。' }
    const linkedAudioPlacement = planned.placements.find((placement) => placement.mediaType === 'audio')

    items.push(...buildMediaTimelineItems({
      media: selection.media,
      mediaId: selection.mediaId,
      mediaType: selection.mediaType,
      label: selection.media.fileName,
      projectFps: fps,
      blobUrl,
      thumbnailUrl: null,
      canvasWidth,
      canvasHeight,
      placements: {
        primary: primaryPlacement,
        linkedAudio: linkedAudioPlacement,
      },
      linkVideoAudio: planned.linkVideoAudio,
      sourceStart: selection.sourceStart,
      sourceEnd: selection.sourceEnd,
    }))
  }

  if ((useTimelineStore.getState().changeVersion ?? 0) !== expectedRevision) {
    return { ok: false, message: '时间轴已发生变化，请重新生成剪辑计划。' }
  }

  addItemsOnNewTracks(items, tracks)
  return {
    ok: true,
    message: `已将 ${resolved.selections.length} 段素材加入时间轴。`,
    data: { mediaCount: resolved.selections.length, itemCount: items.length },
  }
}
