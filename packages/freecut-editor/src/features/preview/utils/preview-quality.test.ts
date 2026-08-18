import { describe, expect, it } from 'vite-plus/test'
import { getActivePreviewDecodeMaxDimension } from './preview-quality'

describe('getActivePreviewDecodeMaxDimension', () => {
  it('reduces full quality by one step while dragging', () => {
    expect(getActivePreviewDecodeMaxDimension(1920, 1080, 1)).toBe(960)
  })

  it('uses the selected lower quality as the drag ceiling', () => {
    expect(getActivePreviewDecodeMaxDimension(3840, 2160, 0.33)).toBe(1267)
    expect(getActivePreviewDecodeMaxDimension(1920, 1080, 0.25)).toBe(480)
  })
})
