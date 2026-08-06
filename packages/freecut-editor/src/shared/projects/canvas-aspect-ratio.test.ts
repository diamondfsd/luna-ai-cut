// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { findCanvasAspectRatioPreset, resizeCanvasToAspectRatio } from './canvas-aspect-ratio'

describe('canvas aspect ratio', () => {
  it('keeps the working long edge while switching orientation', () => {
    expect(resizeCanvasToAspectRatio({ width: 1920, height: 1080 }, 9 / 16)).toEqual({
      width: 1080,
      height: 1920,
    })
  })

  it('uses even canvas dimensions for codec-compatible rendering', () => {
    const result = resizeCanvasToAspectRatio({ width: 1920, height: 1080 }, 2.35)
    expect(result.width).toBe(1920)
    expect(result.height % 2).toBe(0)
  })

  it('recognizes preset ratios with dimension rounding tolerance', () => {
    expect(findCanvasAspectRatioPreset(1920, 818)?.id).toBe('2.35:1')
  })
})
