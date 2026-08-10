// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { buildExportFramePlan, compositionFrameForOutputFrame } from './export-frame-rate'

describe('export frame rate', () => {
  it('preserves duration while sampling a 30 fps timeline at 60 fps', () => {
    const plan = buildExportFramePlan(300, 30, 60)

    expect(plan.durationSeconds).toBe(10)
    expect(plan.totalFrames).toBe(600)
    expect(compositionFrameForOutputFrame(120, plan)).toBe(60)
  })

  it('preserves duration for fractional output rates', () => {
    const plan = buildExportFramePlan(300, 30, 29.97)

    expect(plan.totalFrames).toBe(300)
    expect(compositionFrameForOutputFrame(299, plan)).toBeCloseTo(299.2993, 4)
  })
})
