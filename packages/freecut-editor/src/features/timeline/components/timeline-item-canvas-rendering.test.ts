import { describe, expect, it, vi } from 'vite-plus/test'
import type { VideoItem } from '@freecut/types/timeline'
import {
  drawInactiveTimelineCanvasItems,
  getTimelineCanvasClipPalette,
  getTimelineCanvasClipRect,
  isTimelineCanvasClipVisible,
} from './timeline-item-canvas-rendering'

const item: VideoItem = {
  id: 'clip-1',
  type: 'video',
  trackId: 'track-1',
  from: 30,
  durationInFrames: 60,
  label: 'Clip 1',
  src: 'blob:test',
}

describe('timeline canvas clip rendering', () => {
  it('draws only visible inactive clips', () => {
    const fillRect = vi.fn()
    const context = {
      beginPath: vi.fn(),
      clip: vi.fn(),
      fillRect,
      fillText: vi.fn(),
      rect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    const rendered = drawInactiveTimelineCanvasItems({
      context,
      items: [item, { ...item, id: 'promoted', from: 0 }, { ...item, id: 'offscreen', from: 3000 }],
      promotedItemIds: new Set(['promoted']),
      fps: 30,
      pixelsPerSecond: 60,
      scrollLeft: 0,
      trackHeight: 72,
      viewportWidth: 200,
    })

    expect(rendered).toBe(1)
    expect(fillRect).toHaveBeenCalled()
  })

  it('converts frame positions into viewport-relative pixels', () => {
    expect(
      getTimelineCanvasClipRect({
        item,
        fps: 30,
        pixelsPerSecond: 60,
        scrollLeft: 30,
        trackHeight: 72,
      }),
    ).toEqual({
      left: 30,
      top: 1,
      width: 120,
      height: 70,
      right: 150,
      bottom: 71,
    })
  })

  it('culls clips fully outside the canvas viewport', () => {
    expect(
      isTimelineCanvasClipVisible(
        getTimelineCanvasClipRect({
          item,
          fps: 30,
          pixelsPerSecond: 60,
          scrollLeft: 200,
          trackHeight: 72,
        }),
        100,
      ),
    ).toBe(false)
  })

  it('uses distinct palettes for timeline item types', () => {
    expect(getTimelineCanvasClipPalette('video')).not.toEqual(getTimelineCanvasClipPalette('audio'))
  })
})
