import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@freecut/types/timeline'
import { getTrackItemRelations } from './items-store-indexes'

function makeVideoItem(overrides: Partial<VideoItem> = {}): VideoItem {
  return {
    id: 'item',
    type: 'video',
    trackId: 'track-1',
    from: 20,
    durationInFrames: 10,
    label: 'clip.mp4',
    src: 'blob:test',
    mediaId: 'media-1',
    ...overrides,
  }
}

describe('getTrackItemRelations', () => {
  it('preserves first-match clip neighbors and deterministic drag ties', () => {
    const target = makeVideoItem({ id: 'target' })
    const rightFirst = makeVideoItem({ id: 'right-first', from: 30 })
    const rightSecond = makeVideoItem({ id: 'right-second', from: 30 })
    const leftFirst = makeVideoItem({ id: 'left-first', from: 10 })
    const leftSecond = makeVideoItem({
      id: 'left-second',
      from: 0,
      durationInFrames: 20,
    })
    const trackItems = [rightFirst, rightSecond, leftFirst, leftSecond, target]

    const relations = getTrackItemRelations(trackItems, target)

    expect(relations.leftNeighbor?.id).toBe('left-first')
    expect(relations.rightNeighbor?.id).toBe('right-first')
    expect(relations.neighborKey).toBe('left-second|right-second')
    expect(relations.dragNeighborIds).toEqual({
      leftId: 'left-first',
      rightId: 'right-second',
    })
  })

  it('measures the gap from the greatest completed end and ignores overlaps', () => {
    const target = makeVideoItem({ id: 'target', from: 100 })
    const early = makeVideoItem({ id: 'early', from: 10, durationInFrames: 30 })
    const nearest = makeVideoItem({ id: 'nearest', from: 60, durationInFrames: 20 })
    const overlapping = makeVideoItem({
      id: 'overlapping',
      from: 90,
      durationInFrames: 30,
    })
    const trackItems = [overlapping, early, target, nearest]

    const relations = getTrackItemRelations(trackItems, target)

    expect(relations.leftNeighbor).toBeNull()
    expect(relations.gapBeforeFrames).toBe(20)
  })

  it('reuses the cached relation for an unchanged track array', () => {
    const target = makeVideoItem({ id: 'target' })
    const trackItems = [target]

    expect(getTrackItemRelations(trackItems, target)).toBe(
      getTrackItemRelations(trackItems, target),
    )
  })
})
