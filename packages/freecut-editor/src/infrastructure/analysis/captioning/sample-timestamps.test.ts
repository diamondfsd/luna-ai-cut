// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  buildCaptionTimestamps,
  buildCaptionTimestampsForRanges,
  MAX_VIDEO_CAPTION_SAMPLES,
  resolveCaptioningIntervalForDuration,
} from './sample-timestamps'

describe('caption sample timestamps', () => {
  it('keeps the configured cadence for short videos', () => {
    expect(buildCaptionTimestamps(11, 3)).toEqual([0, 3, 6, 9, 10.9])
    expect(resolveCaptioningIntervalForDuration(3, 11)).toBe(3)
  })

  it('caps long videos while covering their full duration', () => {
    const duration = 5814
    const interval = resolveCaptioningIntervalForDuration(3, duration)
    const timestamps = buildCaptionTimestamps(duration, interval)

    expect(timestamps).toHaveLength(MAX_VIDEO_CAPTION_SAMPLES)
    expect(interval).toBeGreaterThan(3)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeCloseTo(duration - 0.1, 6)
    expect(timestamps.every((time) => time >= 0 && time < duration)).toBe(true)
  })

  it('never exceeds a caller-provided sample cap', () => {
    const timestamps = buildCaptionTimestamps(60, 0.5, 20)

    expect(timestamps).toHaveLength(20)
    expect(timestamps.at(-1)).toBeCloseTo(59.9, 6)
  })

  it('falls back to a safe cadence for invalid input', () => {
    expect(resolveCaptioningIntervalForDuration(Number.NaN, 8)).toBe(3)
    expect(buildCaptionTimestamps(0, 3)).toEqual([])
  })

  it('samples only transcript-selected ranges and merges overlaps', () => {
    expect(buildCaptionTimestampsForRanges(5814, 3, [
      { startSeconds: 120, endSeconds: 128 },
      { startSeconds: 126, endSeconds: 134 },
      { startSeconds: 3000, endSeconds: 3004 },
    ])).toEqual([120, 123, 126, 129, 132, 133.9, 3000, 3003, 3003.9])
  })

  it('keeps targeted visual sampling bounded', () => {
    const ranges = Array.from({ length: 20 }, (_, index) => ({
      startSeconds: index * 20,
      endSeconds: index * 20 + 15,
    }))
    const timestamps = buildCaptionTimestampsForRanges(600, 1, ranges, 10)
    expect(timestamps).toHaveLength(10)
    expect(timestamps[0]).toBe(0)
    expect(timestamps.at(-1)).toBeCloseTo(380, 6)
    expect(timestamps.filter((time) => time < 15)).toHaveLength(1)
    expect(timestamps.filter((time) => time >= 380 && time < 395)).toHaveLength(1)
  })

  it('does not starve later ranges when the targeted sample cap is reached', () => {
    const timestamps = buildCaptionTimestampsForRanges(600, 3, [
      { startSeconds: 0, endSeconds: 60 },
      { startSeconds: 300, endSeconds: 360 },
      { startSeconds: 540, endSeconds: 600 },
    ], 6)

    expect(timestamps).toHaveLength(6)
    expect(timestamps.some((time) => time < 60)).toBe(true)
    expect(timestamps.some((time) => time >= 300 && time < 360)).toBe(true)
    expect(timestamps.some((time) => time >= 540 && time < 600)).toBe(true)
  })
})
