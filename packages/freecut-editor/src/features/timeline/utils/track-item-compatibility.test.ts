// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem, TimelineTrack } from '@freecut/types/timeline'
import {
  assertItemTrackCompatibility,
  findCompatibleTrackForItemType,
} from './track-item-compatibility'

function makeTrack(id: string, order: number, kind: 'video' | 'audio' | 'subtitle'): TimelineTrack {
  return {
    id,
    name: id,
    kind,
    order,
    height: 64,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    items: [],
  }
}

describe('findCompatibleTrackForItemType', () => {
  it('only places subtitle items on subtitle tracks', () => {
    const tracks = [
      makeTrack('subtitle-1', -1, 'subtitle'),
      makeTrack('video-1', 0, 'video'),
      makeTrack('audio-1', 1, 'audio'),
    ]

    expect(
      findCompatibleTrackForItemType({ tracks, items: [], itemType: 'subtitle' })?.id,
    ).toBe('subtitle-1')
    expect(
      findCompatibleTrackForItemType({
        tracks,
        items: [],
        itemType: 'video',
        preferredTrackId: 'subtitle-1',
        allowPreferredTrackFallback: false,
      }),
    ).toBeNull()
  })

  it('only places plain text on dedicated text tracks', () => {
    const tracks = [
      makeTrack('subtitle-1', -1, 'subtitle'),
      makeTrack('video-1', 0, 'video'),
      makeTrack('audio-1', 1, 'audio'),
    ]

    expect(
      findCompatibleTrackForItemType({
        tracks,
        items: [],
        itemType: 'text',
        preferredTrackId: 'audio-1',
      })?.id,
    ).toBe('subtitle-1')
  })

  it('does not fall back when strict preferred track matching is requested', () => {
    const tracks = [
      makeTrack('subtitle-1', -1, 'subtitle'),
      makeTrack('video-1', 0, 'video'),
      makeTrack('audio-1', 1, 'audio'),
    ]

    expect(
      findCompatibleTrackForItemType({
        tracks,
        items: [] as TimelineItem[],
        itemType: 'text',
        preferredTrackId: 'audio-1',
        allowPreferredTrackFallback: false,
      }),
    ).toBeNull()
  })

  it('rejects plain text on a video track at the data boundary', () => {
    const item = {
      id: 'text-1',
      type: 'text',
      trackId: 'video-1',
      from: 0,
      durationInFrames: 30,
      label: 'Title',
      text: 'Title',
    } as TimelineItem

    expect(() => assertItemTrackCompatibility(item, [makeTrack('video-1', 0, 'video')]))
      .toThrow('文字不能放在“video-1”轨道。')
    expect(() => assertItemTrackCompatibility(
      { ...item, trackId: 'subtitle-1' },
      [makeTrack('subtitle-1', -1, 'subtitle')],
    )).not.toThrow()
  })

  it('treats hidden tracks as compatible by default', () => {
    const tracks = [
      { ...makeTrack('video-1', 0, 'video'), visible: false },
      makeTrack('video-2', 1, 'video'),
    ]

    expect(
      findCompatibleTrackForItemType({
        tracks,
        items: [] as TimelineItem[],
        itemType: 'image',
        preferredTrackId: 'video-1',
        allowPreferredTrackFallback: false,
      })?.id,
    ).toBe('video-1')
  })

  it('still allows callers to exclude hidden tracks explicitly', () => {
    const tracks = [
      { ...makeTrack('video-1', 0, 'video'), visible: false },
      makeTrack('video-2', 1, 'video'),
    ]

    expect(
      findCompatibleTrackForItemType({
        tracks,
        items: [] as TimelineItem[],
        itemType: 'image',
        preferredTrackId: 'video-1',
        includeHidden: false,
      })?.id,
    ).toBe('video-2')
  })
})
