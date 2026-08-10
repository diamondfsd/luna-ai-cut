import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import { getTrackKind, type TrackKind } from './classic-tracks'

const REQUIRED_TRACK_KINDS: readonly TrackKind[] = ['video', 'audio']

export function getRemovableTrackIds(
  tracks: readonly TimelineTrack[],
  requestedTrackIds: readonly string[],
): string[] {
  const requested = new Set(requestedTrackIds)
  const protectedIds = new Set<string>()

  for (const kind of REQUIRED_TRACK_KINDS) {
    const kindTracks = tracks.filter((track) => getTrackKind(track) === kind)
    if (kindTracks.length === 0 || kindTracks.some((track) => !requested.has(track.id))) continue
    protectedIds.add(kindTracks[0]!.id)
  }

  return tracks
    .filter((track) => requested.has(track.id) && !protectedIds.has(track.id))
    .map((track) => track.id)
}

export function canRemoveTrack(tracks: readonly TimelineTrack[], trackId: string): boolean {
  return getRemovableTrackIds(tracks, [trackId]).includes(trackId)
}

export function assertRequiredTracksPreserved(
  previousTracks: readonly TimelineTrack[],
  nextTracks: readonly TimelineTrack[],
): void {
  for (const kind of REQUIRED_TRACK_KINDS) {
    const previouslyPresent = previousTracks.some((track) => getTrackKind(track) === kind)
    const stillPresent = nextTracks.some((track) => getTrackKind(track) === kind)
    if (previouslyPresent && !stillPresent) {
      throw new Error(kind === 'video' ? '时间轴至少需要一条视频轨道。' : '时间轴至少需要一条音频轨道。')
    }
  }
}

export function getEmptyTrackIdsForRemoval(
  tracks: TimelineTrack[],
  itemsByTrackId: Record<string, TimelineItem[]>,
  contextTrackId: string,
): string[] {
  const emptyTrackIds = tracks
    .filter((track) => (itemsByTrackId[track.id]?.length ?? 0) === 0)
    .map((track) => track.id)
  const removableIds = getRemovableTrackIds(tracks, emptyTrackIds)
  if (removableIds.length < tracks.length) return removableIds
  return removableIds.filter((trackId) => trackId !== contextTrackId)
}
