// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import {
  assertRequiredTracksPreserved,
  canRemoveTrack,
  getEmptyTrackIdsForRemoval,
  getRemovableTrackIds,
} from './track-removal'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 0,
    order: 0,
    items: [],
    ...overrides,
  }
}

function makeItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'audio',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 30,
    label: 'Audio clip',
    src: 'audio.mp3',
    ...overrides,
  } as TimelineItem
}

describe('getEmptyTrackIdsForRemoval', () => {
  it('keeps tracks that have items in itemsByTrackId', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
      makeTrack({ id: 'a2', name: 'A2', kind: 'audio', order: 2 }),
    ]

    const itemsByTrackId = {
      a1: [makeItem({ id: 'audio-1', trackId: 'a1' })],
    }

    expect(getEmptyTrackIdsForRemoval(tracks, itemsByTrackId, 'v1')).toEqual(['a2'])
  })

  it('preserves the context track when every track is empty', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]

    expect(getEmptyTrackIdsForRemoval(tracks, {}, 'a1')).toEqual([])
  })

  it('never removes the final video or audio track', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'v2', name: 'V2', kind: 'video', order: 1 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 2 }),
    ]

    expect(canRemoveTrack(tracks, 'v1')).toBe(true)
    expect(canRemoveTrack(tracks, 'a1')).toBe(false)
    expect(getRemovableTrackIds(tracks, ['v1', 'v2', 'a1'])).toEqual(['v2'])
  })

  it('rejects store writes that remove a required track kind', () => {
    const tracks = [
      makeTrack({ id: 'v1', name: 'V1', kind: 'video', order: 0 }),
      makeTrack({ id: 'a1', name: 'A1', kind: 'audio', order: 1 }),
    ]
    expect(() => assertRequiredTracksPreserved(tracks, tracks.slice(0, 1)))
      .toThrow('时间轴至少需要一条音频轨道。')
  })
})
