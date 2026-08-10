import { useProjectStore } from '@freecut/features/media-library/deps/projects'
import {
  removeTimelineItemsExact,
  useTimelineStore,
} from '@freecut/features/media-library/deps/timeline-stores'
import { useSelectionStore } from '@freecut/shared/state/selection'
import {
  extractMatroskaTextSubtitleTracksFromBlob,
  type EmbeddedSubtitleTrack,
} from '@freecut/shared/utils/matroska-subtitles'
import {
  getEmbeddedSubtitleSidecar,
  saveEmbeddedSubtitleSidecar,
} from '@freecut/infrastructure/storage'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@freecut/shared/projects/defaults'
import type { MediaMetadata } from '@freecut/types/storage'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import {
  buildCaptionTrack,
  buildSubtitleTextItemsForClip,
  findCaptionTargetClipsForMedia,
  findCompatibleCaptionTrackForRanges,
} from '../utils/caption-items'

export interface ExtractEmbeddedSubtitlesResult {
  insertedItemCount: number
  cueCount: number
  trackLabel: string
}

interface EmbeddedSubtitleScanResult {
  tracks: readonly EmbeddedSubtitleTrack[]
  scannedAt: number
  fromCache: boolean
}

interface SubtitleScanProgressInfo {
  bytesRead: number
  totalBytes: number
  clusters: number
}

interface SubtitleScanOptions {
  onProgress?: (info: SubtitleScanProgressInfo) => void
  signal?: AbortSignal
}

class SubtitleSidecarService {
  /**
   * Walk the source bytes for `media` and return its embedded text-subtitle
   * tracks. Cached in workspace-fs after the first scan so re-opening the
   * picker is instant. Cache is invalidated when the source's `fileSize`
   * (or `lastModified`, when available) changes.
   *
   * `onProgress` fires periodically during the parse with read/total bytes;
   * `signal` aborts mid-scan.
   */
  async scanEmbeddedSubtitleTracks(
    media: MediaMetadata,
    file: Blob,
    options: SubtitleScanOptions = {},
  ): Promise<EmbeddedSubtitleScanResult> {
    const fingerprint = {
      fileSize: file.size,
      fileLastModified: file instanceof File ? file.lastModified : undefined,
    }
    const cached = await getEmbeddedSubtitleSidecar(media.id, fingerprint)
    if (cached) {
      // Surface a single 100% tick so callers showing a progress bar can
      // settle their UI even when we short-circuit the parse.
      options.onProgress?.({ bytesRead: file.size, totalBytes: file.size, clusters: 0 })
      return { tracks: cached.tracks, scannedAt: cached.scannedAt, fromCache: true }
    }

    const tracks = await extractMatroskaTextSubtitleTracksFromBlob(file, {
      onProgress: options.onProgress,
      signal: options.signal,
    })
    let scannedAt = Date.now()
    if (tracks.length > 0) {
      const saved = await saveEmbeddedSubtitleSidecar(media.id, fingerprint, tracks).catch(
        () => null,
      )
      if (saved) scannedAt = saved.scannedAt
    }
    return { tracks, scannedAt, fromCache: false }
  }

  /** Insert each embedded subtitle cue as an ordinary caption-marked text item. */
  insertEmbeddedSubtitleTrack(
    media: MediaMetadata,
    track: EmbeddedSubtitleTrack,
  ): ExtractEmbeddedSubtitlesResult {
    const trackLabel = formatEmbeddedSubtitleTrackLabel(track)
    const inserted = this.insertSubtitleCuesForMedia(media, track)
    return {
      insertedItemCount: inserted,
      cueCount: track.cues.length,
      trackLabel,
    }
  }

  private insertSubtitleCuesForMedia(media: MediaMetadata, track: EmbeddedSubtitleTrack): number {
    const timeline = useTimelineStore.getState()
    const project = useProjectStore.getState().currentProject
    const canvasWidth = project?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = project?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const clips = findCaptionTargetClipsForMedia(timeline.items, media.id)
    if (clips.length === 0) return 0

    // Replace captions previously extracted from the same target clips.
    const clipIdSet = new Set(clips.map((c) => c.id))
    const obsoleteIds = timeline.items
      .filter((item) => isEmbeddedCaptionForClip(item, clipIdSet))
      .map((item) => item.id)

    const captionItems = [] as Array<Extract<TimelineItem, { type: 'text' }>>
    for (const clip of clips) {
      captionItems.push(
        ...buildSubtitleTextItemsForClip({
          trackId: clip.trackId,
          cues: track.cues,
          clip,
          timelineFps: timeline.fps,
          canvasWidth,
          canvasHeight,
          fileName: media.fileName,
          format: 'srt',
          sourceType: 'embedded-subtitles',
          sourceMetadata: {
            trackNumber: track.trackNumber,
            language: track.language,
            trackName: track.name,
            codecId: track.codecId,
            importedAt: Date.now(),
          },
        }),
      )
    }
    if (captionItems.length === 0) {
      if (obsoleteIds.length > 0) removeTimelineItemsExact(obsoleteIds)
      return 0
    }

    if (obsoleteIds.length > 0) removeTimelineItemsExact(obsoleteIds)

    // Pick a single track that can host every cue's range so captions
    // stay on one row rather than scattering across several.
    const ranges = captionItems.map((s) => ({
      startFrame: s.from,
      endFrame: s.from + s.durationInFrames,
    }))
    let nextTracks: TimelineTrack[] = [...timeline.tracks]
    // After removing the obsolete items, look up the timeline state again so
    // findCompatibleCaptionTrackForRanges sees the post-removal items.
    const refreshed = useTimelineStore.getState()
    let target = findCompatibleCaptionTrackForRanges(nextTracks, refreshed.items, ranges)
    if (!target) {
      target = buildCaptionTrack(nextTracks)
      nextTracks = [...nextTracks, target].sort((a, b) => a.order - b.order)
      refreshed.setTracks(nextTracks)
    }
    const placedItems = captionItems.map((item) => ({ ...item, trackId: target.id }))

    refreshed.addItems(placedItems)
    useSelectionStore.getState().selectItems(placedItems.map((item) => item.id))
    return placedItems.length
  }
}

function isEmbeddedCaptionForClip(item: TimelineItem, clipIds: ReadonlySet<string>): boolean {
  if (item.type !== 'text' || item.textRole !== 'caption') return false
  const source = item.captionSource
  return source !== undefined && source.type === 'embedded-subtitles' && clipIds.has(source.clipId)
}

export const subtitleSidecarService = new SubtitleSidecarService()

export function chooseEmbeddedSubtitleTrackForMedia(
  tracks: readonly EmbeddedSubtitleTrack[],
): EmbeddedSubtitleTrack | null {
  return chooseEmbeddedSubtitleTrack(tracks)
}

export function getEmbeddedSubtitleTrackLabel(track: EmbeddedSubtitleTrack): string {
  return formatEmbeddedSubtitleTrackLabel(track)
}

function chooseEmbeddedSubtitleTrack(
  tracks: readonly EmbeddedSubtitleTrack[],
): EmbeddedSubtitleTrack | null {
  return (
    tracks.find((track) => track.forced) ??
    tracks.find((track) => track.default) ??
    tracks.find((track) => /^en(?:g|[-_]|$)/i.test(track.language)) ??
    tracks[0] ??
    null
  )
}

function formatEmbeddedSubtitleTrackLabel(track: EmbeddedSubtitleTrack): string {
  const parts = [track.name, track.language !== 'und' ? track.language : undefined].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : `Track ${track.trackNumber}`
}
