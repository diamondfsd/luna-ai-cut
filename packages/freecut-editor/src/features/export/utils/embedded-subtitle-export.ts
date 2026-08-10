import type { CompositionInputProps, SubtitleExportMode } from '@freecut/types/export'
import type { TextItem, TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { serializeVtt, type SubtitleCue } from '@freecut/shared/utils/subtitles'

export interface SubtitleExportPlan {
  /** Mux the transcript as a soft WebVTT track. */
  embedTranscriptSubtitles: boolean
  /** Keep transcript items in the rendered composition so they burn in. */
  burnInSubtitles: boolean
  /** `embedded` was requested but can't be honoured — burning in instead. */
  fallbackToBurnIn: boolean
}

/**
 * Subtitle handling per mode (moved verbatim from the export orchestrator):
 * - `burn`   : keep the transcript items so they render into the frames.
 * - `off`    : drop them (no captions).
 * - `sidecar`: drop them here — the clean video is muxed; the .srt file is
 *              generated and downloaded on the main thread.
 * - `embedded`: mux a soft WebVTT track, but ONLY for Matroska (WebM/MKV).
 *   mediabunny never starts its ISOBMFF subtitle `auxWriter`, so WebVTT-into-
 *   MP4/MOV asserts ("Assertion failed") via an uncatchable floating rejection;
 *   there we fall back to burning captions in so they aren't silently lost.
 */
export function resolveSubtitleExportPlan(params: {
  subtitleMode: SubtitleExportMode
  container: string
  supportsWebVttSubtitles: boolean
  hasTranscriptVtt: boolean
}): SubtitleExportPlan {
  const { subtitleMode, container, supportsWebVttSubtitles, hasTranscriptVtt } = params
  const isIsobmffContainer = container === 'mp4' || container === 'mov'
  const embedTranscriptSubtitles =
    subtitleMode === 'embedded' &&
    hasTranscriptVtt &&
    supportsWebVttSubtitles &&
    !isIsobmffContainer
  const burnInSubtitles =
    subtitleMode === 'burn' || (subtitleMode === 'embedded' && !embedTranscriptSubtitles)
  const fallbackToBurnIn =
    subtitleMode === 'embedded' && hasTranscriptVtt && !embedTranscriptSubtitles
  return { embedTranscriptSubtitles, burnInSubtitles, fallbackToBurnIn }
}

function isTranscriptCaptionItem(item: TimelineItem): item is TextItem {
  return (
    item.type === 'text' && item.textRole === 'caption' && item.captionSource?.type === 'transcript'
  )
}

/**
 * Collect transcript subtitle cues from the (export-trimmed) composition,
 * offset to the export timeline and clamped to its duration. Returns [] when
 * there are none. Shared by the soft-embed (VTT) and sidecar (SRT) paths.
 */
export function buildTranscriptSubtitleCues(composition: CompositionInputProps): SubtitleCue[] {
  const fps = composition.fps
  const durationSeconds =
    composition.durationInFrames !== undefined ? composition.durationInFrames / fps : Infinity

  const cues: SubtitleCue[] = []

  for (const track of composition.tracks) {
    if (track.visible === false) continue

    for (const item of track.items ?? []) {
      if (!isTranscriptCaptionItem(item)) continue

      const itemStartSeconds = item.from / fps
      const itemEndSeconds = (item.from + item.durationInFrames) / fps

      const startSeconds = Math.max(0, itemStartSeconds)
      const endSeconds = Math.min(durationSeconds, itemEndSeconds)
      if (endSeconds <= startSeconds || item.text.trim().length === 0) continue
      cues.push({ id: item.id, startSeconds, endSeconds, text: item.text })
    }
  }

  // Items can be processed track-by-track in any order, but subtitle consumers
  // expect cues sorted chronologically. Sort by start time, breaking ties by
  // end time so deterministically-overlapping cues don't reorder.
  cues.sort((a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds)
  return cues
}

export function buildTranscriptSubtitleWebVtt(composition: CompositionInputProps): string | null {
  const cues = buildTranscriptSubtitleCues(composition)
  if (cues.length === 0) return null
  return serializeVtt(cues)
}

export function omitTranscriptSubtitleItemsForSoftSubtitleExport(
  composition: CompositionInputProps,
): CompositionInputProps {
  return {
    ...composition,
    tracks: composition.tracks.map(
      (track): TimelineTrack => ({
        ...track,
        items: (track.items ?? []).filter((item) => !isTranscriptCaptionItem(item)),
      }),
    ),
  }
}
