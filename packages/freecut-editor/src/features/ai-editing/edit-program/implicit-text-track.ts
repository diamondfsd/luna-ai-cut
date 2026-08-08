import { getTrackKind } from '@freecut/features/editor/deps/timeline-contract'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'

interface ResolveImplicitTextTrackParams {
  tracks: TimelineTrack[]
  items: TimelineItem[]
  originalTextTrackIds: ReadonlySet<string>
  startFrame: number
  endFrame: number
}

export function resolveImplicitTextTrack(
  params: ResolveImplicitTextTrackParams,
): { trackId: string; tracks: TimelineTrack[] } | null {
  const itemsByTrackId = new Map<string, TimelineItem[]>()
  for (const item of params.items) {
    const trackItems = itemsByTrackId.get(item.trackId)
    if (trackItems) trackItems.push(item)
    else itemsByTrackId.set(item.trackId, [item])
  }

  const track =
    params.tracks
      .filter((candidate) => {
        if (
          candidate.isGroup ||
          candidate.locked ||
          candidate.visible === false ||
          getTrackKind(candidate) !== 'video'
        ) {
          return false
        }
        const trackItems = itemsByTrackId.get(candidate.id) ?? []
        const isTextTrack =
          params.originalTextTrackIds.has(candidate.id) ||
          trackItems.some((item) => item.type === 'text' || item.type === 'subtitle')
        if (!isTextTrack && trackItems.length > 0) return false
        return trackItems.every(
          (item) =>
            item.from + item.durationInFrames <= params.startFrame || item.from >= params.endFrame,
        )
      })
      .toSorted((left, right) => {
        const leftWasTextTrack = params.originalTextTrackIds.has(left.id)
        const rightWasTextTrack = params.originalTextTrackIds.has(right.id)
        if (leftWasTextTrack !== rightWasTextTrack) return leftWasTextTrack ? -1 : 1
        return left.order - right.order
      })[0] ?? null
  if (!track) return null
  if (!params.originalTextTrackIds.has(track.id)) {
    return { trackId: track.id, tracks: params.tracks }
  }

  const occupiedTrackIds = new Set(params.items.map((item) => item.trackId))
  const nextOccupiedVideoOrder = params.tracks
    .filter(
      (candidate) =>
        candidate.order > track.order &&
        getTrackKind(candidate) === 'video' &&
        occupiedTrackIds.has(candidate.id),
    )
    .reduce<number | null>(
      (nearest, candidate) =>
        nearest === null ? candidate.order : Math.min(nearest, candidate.order),
      null,
    )
  if (nextOccupiedVideoOrder === null) {
    return { trackId: track.id, tracks: params.tracks }
  }

  return {
    trackId: track.id,
    tracks: params.tracks.filter(
      (candidate) =>
        candidate.id === track.id ||
        candidate.isGroup ||
        candidate.locked ||
        getTrackKind(candidate) !== 'video' ||
        occupiedTrackIds.has(candidate.id) ||
        candidate.order <= track.order ||
        candidate.order >= nextOccupiedVideoOrder,
    ),
  }
}
