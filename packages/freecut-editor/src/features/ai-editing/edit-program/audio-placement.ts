import { createClassicTrack, getTrackKind } from '@freecut/features/editor/deps/timeline-contract'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'

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
