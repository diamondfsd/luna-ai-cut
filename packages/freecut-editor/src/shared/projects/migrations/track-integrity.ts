import type { ProjectTimeline } from '@freecut/types/project'
import type { ProjectWarning } from './types'

type ProjectItem = ProjectTimeline['items'][number]

function buildTransitionPairs(
  transitions?: NonNullable<ProjectTimeline['transitions']>,
): Set<string> {
  const pairs = new Set<string>()
  if (!transitions) return pairs
  for (const transition of transitions) {
    pairs.add(`${transition.leftClipId}:${transition.rightClipId}`)
    pairs.add(`${transition.rightClipId}:${transition.leftClipId}`)
  }
  return pairs
}

function getCaptionOwnerClipId(item: ProjectItem): string | null {
  if (item.type === 'text' && item.textRole === 'caption' && item.captionSource?.clipId) {
    return item.captionSource.clipId
  }
  return null
}

function getOverlapRepairCohortIds(
  items: ProjectTimeline['items'],
  anchor: ProjectItem,
): Set<string> {
  if (anchor.type !== 'video' && anchor.type !== 'audio') return new Set([anchor.id])

  const mediaIds = new Set(
    items
      .filter(
        (item) =>
          item.id === anchor.id ||
          (anchor.linkedGroupId !== undefined && item.linkedGroupId === anchor.linkedGroupId),
      )
      .map((item) => item.id),
  )
  const cohortIds = new Set(mediaIds)
  for (const item of items) {
    const ownerClipId = getCaptionOwnerClipId(item)
    if (ownerClipId && mediaIds.has(ownerClipId)) cohortIds.add(item.id)
  }
  return cohortIds
}

/**
 * Repair the legacy failure where every linked audio item was left behind by
 * the same amount after video-track overlap repair. Two matching offsets are
 * required so an isolated creative sync offset remains untouched.
 */
export function repairUniformLinkedOffsets(
  items: ProjectTimeline['items'],
): ProjectTimeline['items'] {
  const repaired = items.map((item) => ({ ...item })) as ProjectTimeline['items']
  const groups = new Map<string, { video?: ProjectItem; audio?: ProjectItem }>()
  for (const item of repaired) {
    if (!item.linkedGroupId || (item.type !== 'video' && item.type !== 'audio')) continue
    const group = groups.get(item.linkedGroupId) ?? {}
    if (item.type === 'video') group.video = item
    else group.audio = item
    groups.set(item.linkedGroupId, group)
  }

  const offsetCounts = new Map<number, number>()
  for (const { video, audio } of groups.values()) {
    if (!video || !audio) continue
    const offset = video.from - audio.from
    if (offset === 0 || video.durationInFrames !== audio.durationInFrames) continue
    offsetCounts.set(offset, (offsetCounts.get(offset) ?? 0) + 1)
  }
  const repairableOffsets = new Set(
    [...offsetCounts].filter(([, count]) => count >= 2).map(([offset]) => offset),
  )
  if (repairableOffsets.size === 0) return repaired

  for (const { video, audio } of groups.values()) {
    if (!video || !audio) continue
    const offset = video.from - audio.from
    if (!repairableOffsets.has(offset)) continue
    audio.from = video.from
    for (const item of repaired) {
      if (getCaptionOwnerClipId(item) === video.id) item.from += offset
    }
  }
  return repaired
}

/** Push overlapping content forward while preserving linked A/V and captions. */
export function repairOverlappingItems(
  items: ProjectTimeline['items'],
  transitions?: NonNullable<ProjectTimeline['transitions']>,
  warnings?: ProjectWarning[],
  compositionId?: string,
): ProjectTimeline['items'] {
  const transitionPairs = buildTransitionPairs(transitions)
  const repaired = items.map((item) => ({ ...item })) as ProjectTimeline['items']
  const maxPasses = Math.max(1, repaired.length * repaired.length * 2)

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const byTrack = new Map<string, ProjectTimeline['items']>()
    for (const item of repaired) {
      const group = byTrack.get(item.trackId)
      if (group) group.push(item)
      else byTrack.set(item.trackId, [item])
    }
    for (const group of byTrack.values()) group.sort((a, b) => a.from - b.from)

    let collision: { current: ProjectItem; next: ProjectItem; currentEnd: number } | undefined
    for (const group of byTrack.values()) {
      for (let i = 0; i < group.length && !collision; i += 1) {
        const current = group[i]!
        const currentEnd = current.from + current.durationInFrames
        for (let j = i + 1; j < group.length; j += 1) {
          const next = group[j]!
          if (next.from >= currentEnd) break
          if (transitionPairs.has(`${current.id}:${next.id}`)) continue
          collision = { current, next, currentEnd }
          break
        }
      }
      if (collision) break
    }
    if (!collision) break

    const shift = collision.currentEnd - collision.next.from
    let cohortIds = getOverlapRepairCohortIds(repaired, collision.next)
    if (cohortIds.has(collision.current.id)) cohortIds = new Set([collision.next.id])
    for (const item of repaired) {
      if (cohortIds.has(item.id)) item.from += shift
    }
    warnings?.push({
      code: 'TRACK_OVERLAP_REPAIRED',
      message:
        `Items "${collision.current.id}" and "${collision.next.id}" overlap on track ` +
        `"${collision.current.trackId}" (frames ${collision.next.from - shift}-${collision.currentEnd}); ` +
        `"${collision.next.id}" and its linked content were shifted by ${shift} frames`,
      itemIds: [collision.current.id, collision.next.id],
      trackId: collision.current.trackId,
      compositionId,
    })
  }

  return repaired
}
