// @vitest-environment node

import { beforeEach, describe, expect, it } from 'vite-plus/test'
import type { TextItem, TimelineTrack } from '@freecut/types/timeline'
import { useItemsStore } from './items-store'

function makeTrack(id: string, kind: 'video' | 'audio', order: number): TimelineTrack {
  return {
    id,
    name: kind === 'audio' ? 'A1' : 'V1',
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

  it('allows adding plain text to a video track', () => {
    useItemsStore.getState().setTracks([makeTrack('video-1', 'video', 0)])

    expect(() => useItemsStore.getState()._addItem(makeText('video-1'))).not.toThrow()
    expect(useItemsStore.getState().items).toHaveLength(1)
  })

  it('keeps text on video tracks and blocks moving it to audio', () => {
    useItemsStore.getState().setTracks([
      makeTrack('video-1', 'video', 0),
      makeTrack('audio-1', 'audio', 1),
    ])
    useItemsStore.getState()._addItem(makeText('video-1'))

    expect(() => useItemsStore.getState()._moveItem('text-1', 10, 'audio-1'))
      .toThrow('文字不能放在“A1”轨道。')
    expect(useItemsStore.getState().itemById['text-1']?.trackId).toBe('video-1')
  })

  it('accepts a video track containing text', () => {
    const textTrack = makeTrack('video-1', 'video', 0)
    useItemsStore.getState().setTracks([textTrack])
    useItemsStore.getState()._addItem(makeText(textTrack.id))

    expect(() => useItemsStore.getState().setTracks([{ ...textTrack, name: 'V2' }])).not.toThrow()
  })

  it('rejects removing the final video or audio track after initialization', () => {
    const videoTrack = makeTrack('video-1', 'video', 0)
    const audioTrack = makeTrack('audio-1', 'audio', 1)
    useItemsStore.getState().setTracks([videoTrack, audioTrack])

    expect(() => useItemsStore.getState().setTracks([videoTrack]))
      .toThrow('时间轴至少需要一条音频轨道。')
    expect(() => useItemsStore.getState().setTracks([audioTrack]))
      .toThrow('时间轴至少需要一条视频轨道。')
    expect(useItemsStore.getState().tracks).toHaveLength(2)
  })
})
