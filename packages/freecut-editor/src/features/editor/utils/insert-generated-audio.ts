import type { AudioItem } from '@freecut/types/timeline'
import type { MediaMetadata } from '@freecut/types/storage'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { createClassicTrack } from '@freecut/features/editor/deps/timeline-utils'
import { useSelectionStore } from '@freecut/shared/state/selection'

/**
 * Add generated audio to a fresh audio track at the requested playhead frame.
 * The track and item are committed together so one undo removes both.
 */
export function insertGeneratedAudioOnNewTrack(
  media: MediaMetadata,
  blobUrl: string,
  playheadFrame: number,
): boolean {
  const { tracks, fps, addItemOnNewTrack } = useTimelineStore.getState()
  const from = Number.isFinite(playheadFrame) ? Math.max(0, Math.round(playheadFrame)) : 0
  const sourceFps = media.fps || fps
  const durationInFrames = Math.max(1, Math.round(media.duration * fps))
  const sourceDurationFrames = Math.round(media.duration * sourceFps)
  const maxOrder = tracks.reduce((max, track) => Math.max(max, track.order), 0)
  const newTrack = createClassicTrack({ tracks, kind: 'audio', order: maxOrder + 1 })

  const audioItem: AudioItem = {
    id: crypto.randomUUID(),
    type: 'audio',
    trackId: newTrack.id,
    from,
    durationInFrames,
    label: media.fileName,
    mediaId: media.id,
    originId: crypto.randomUUID(),
    src: blobUrl,
    sourceStart: 0,
    sourceEnd: sourceDurationFrames,
    sourceDuration: sourceDurationFrames,
    sourceFps,
    trimStart: 0,
    trimEnd: 0,
  }

  addItemOnNewTrack(audioItem, [...tracks, newTrack])

  const added = useTimelineStore.getState().items.some((item) => item.id === audioItem.id)
  if (added) {
    useSelectionStore.getState().selectItems([audioItem.id])
  }
  return added
}
