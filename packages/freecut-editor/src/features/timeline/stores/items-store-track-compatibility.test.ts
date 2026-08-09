// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem, TimelineTrack } from '@freecut/types/timeline'
import { useItemsStore } from './items-store'

function makeTrack(id: string, kind: 'video' | 'subtitle', order: number): TimelineTrack {
  return {
    id,
    name: kind === 'subtitle' ? 'S1' : 'V1',
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

function makeText(trackId: string): TextItem {
  return {
    id: 'text-1',
    type: 'text',
    trackId,
    from: 0,
    durationInFrames: 30,
    label: 'Title',
    text: 'Title',
    color: '#ffffff',
  }
}

describe('items store track compatibility', () => {
  beforeEach(() => {
    useItemsStore.setState({ items: [], tracks: [] })
  })

  it('rejects adding plain text to a video track', () => {
    useItemsStore.getState().setTracks([makeTrack('video-1', 'video', 0)])

    expect(() => useItemsStore.getState()._addItem(makeText('video-1')))
      .toThrow('文字不能放在“V1”轨道。')
    expect(useItemsStore.getState().items).toEqual([])
  })

  it('allows plain text on a dedicated text track and blocks moving it to video', () => {
    useItemsStore.getState().setTracks([
      makeTrack('text-1', 'subtitle', -1),
      makeTrack('video-1', 'video', 0),
    ])
    useItemsStore.getState()._addItem(makeText('text-1'))

    expect(() => useItemsStore.getState()._moveItem('text-1', 10, 'video-1'))
      .toThrow('文字不能放在“V1”轨道。')
    expect(useItemsStore.getState().itemById['text-1']?.trackId).toBe('text-1')
  })

  it('rejects changing an occupied text track into a video track', () => {
    const textTrack = makeTrack('text-1', 'subtitle', -1)
    useItemsStore.getState().setTracks([textTrack])
    useItemsStore.getState()._addItem(makeText(textTrack.id))

    expect(() => useItemsStore.getState().setTracks([{ ...textTrack, kind: 'video', name: 'V1' }]))
      .toThrow('文字不能放在“V1”轨道。')
  })
})
