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

  const occupiedVisualOrders = params.tracks
    .filter((candidate) => {
      if (candidate.isGroup || getTrackKind(candidate) !== 'video') return false
      return (itemsByTrackId.get(candidate.id) ?? []).some(
        (item) => item.type !== 'text' && item.type !== 'subtitle',
      )
    })
    .map((candidate) => candidate.order)

  const overlayDistance = (candidate: TimelineTrack): number => {
    const tracksBelow = occupiedVisualOrders.filter((order) => order > candidate.order)
    if (tracksBelow.length > 0) {
      return Math.min(...tracksBelow.map((order) => order - candidate.order))
    }
    if (occupiedVisualOrders.length > 0) {
      return Math.min(...occupiedVisualOrders.map((order) => Math.abs(order - candidate.order)))
    }
    return Number.POSITIVE_INFINITY
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
        const leftDistance = overlayDistance(left)
        const rightDistance = overlayDistance(right)
        if (leftDistance < rightDistance) return -1
        if (leftDistance > rightDistance) return 1
        const leftWasTextTrack = params.originalTextTrackIds.has(left.id)
        const rightWasTextTrack = params.originalTextTrackIds.has(right.id)
        if (leftWasTextTrack !== rightWasTextTrack) return leftWasTextTrack ? -1 : 1
        return right.order - left.order
      })[0] ?? null
  if (!track) return null
  if (params.originalTextTrackIds.has(track.id)) {
    return { trackId: track.id, tracks: params.tracks }
  }

  const vacatedTextTracks = params.tracks.filter(
    (candidate) =>
      params.originalTextTrackIds.has(candidate.id) &&
      candidate.order < track.order &&
      (itemsByTrackId.get(candidate.id) ?? []).length === 0,
  )
  if (vacatedTextTracks.length === 0) {
    return { trackId: track.id, tracks: params.tracks }
  }
  const cleanupStartOrder = Math.min(...vacatedTextTracks.map((candidate) => candidate.order))

  return {
    trackId: track.id,
    tracks: params.tracks.filter(
      (candidate) =>
        candidate.order < cleanupStartOrder ||
        candidate.order >= track.order ||
        candidate.isGroup ||
        candidate.locked ||
        candidate.visible === false ||
        getTrackKind(candidate) !== 'video' ||
        (itemsByTrackId.get(candidate.id) ?? []).length > 0,
    ),
  }
}
