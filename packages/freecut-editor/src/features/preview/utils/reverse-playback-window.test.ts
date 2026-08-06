import { describe, expect, it } from 'vite-plus/test'
import {
  resolveReversePlaybackWindowPlan,
  shouldQueueReversePlaybackWindow,
} from './reverse-playback-window'

describe('reverse playback decoded-frame windows', () => {
  it('keeps 1x targets adjacent and ordered backward from the clock frame', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 100,
      fps: 30,
      playbackRate: -1,
      maxSamples: 5,
    })

    expect(plan).toMatchObject({
      highFrame: 100,
      lowFrame: 96,
      strideFrames: 1,
      targetFrames: [100, 99, 98, 97, 96],
    })
  })

  it('skips non-presentable intermediate frames at 4x without changing clock rate', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 200,
      fps: 30,
      playbackRate: -4,
      maxSamples: 5,
      presentationFps: 60,
    })

    expect(plan.strideFrames).toBe(2)
    expect(plan.targetFrames).toEqual([200, 198, 196, 194, 192])
  })

  it('refills only near the consumed edge and never stacks work in flight', () => {
    const prepared = {
      preparedLowFrame: 80,
      preparedHighFrame: 100,
      refillFrame: 88,
    }

    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 94,
        requestInFlight: false,
      }),
    ).toBe(false)
    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 88,
        requestInFlight: false,
      }),
    ).toBe(true)
    expect(
      shouldQueueReversePlaybackWindow({
        ...prepared,
        targetFrame: 70,
        requestInFlight: true,
      }),
    ).toBe(false)
  })

  it('clamps a start-boundary window without duplicate negative targets', () => {
    const plan = resolveReversePlaybackWindowPlan({
      targetFrame: 2,
      fps: 30,
      playbackRate: -4,
      maxSamples: 20,
    })

    expect(plan.targetFrames).toEqual([2, 0])
    expect(plan.lowFrame).toBe(0)
  })
})
