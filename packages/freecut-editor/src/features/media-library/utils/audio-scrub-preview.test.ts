// @vitest-environment node

import { describe, expect, it, vi } from 'vite-plus/test'
import { createAudioScrubPreview, getAudioScrubTime } from './audio-scrub-preview'

function makeFakeAudioContext() {
  const stop = vi.fn()
  const start = vi.fn()
  const connect = vi.fn()
  const disconnect = vi.fn()
  const gain = {
    value: 0,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  }
  const source = {
    buffer: null as AudioBuffer | null,
    connect,
    start,
    stop,
    disconnect,
    onended: null as (() => void) | null,
  }
  const buffer = { duration: 10 } as AudioBuffer
  return {
    context: {
      currentTime: 5,
      destination: {},
      state: 'running' as AudioContextState,
      resume: vi.fn(async () => undefined),
      decodeAudioData: vi.fn(async () => buffer),
      createBufferSource: vi.fn(() => source),
      createGain: vi.fn(() => ({ gain, connect })),
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext,
    source,
    gain,
    buffer,
  }
}

describe('audio scrub preview', () => {
  it('maps pointer progress to a clamped source time', () => {
    expect(getAudioScrubTime(12, 0.25)).toBe(3)
    expect(getAudioScrubTime(12, -1)).toBe(0)
    expect(getAudioScrubTime(12, 2)).toBe(12)
    expect(getAudioScrubTime(0, 0.5)).toBe(0)
  })

  it('plays a short faded grain at the requested source time', async () => {
    const fake = makeFakeAudioContext()
    const scrub = createAudioScrubPreview({
      createAudioContext: () => fake.context,
      fetchArrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
      grainDurationSeconds: 0.08,
    })

    await scrub.scrub({
      mediaId: 'audio-1',
      mediaUrl: 'blob:audio-1',
      timeSeconds: 9.99,
    })

    expect(fake.context.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(fake.source.buffer).toBe(fake.buffer)
    expect(fake.gain.setValueAtTime).toHaveBeenCalledWith(0, 5)
    expect(fake.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 5.008)
    expect(fake.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 5.08)
    expect(fake.source.start).toHaveBeenCalledWith(5, 9.92, 0.08)
  })

  it('stops the previous grain before starting the next one', async () => {
    const first = makeFakeAudioContext()
    const scrub = createAudioScrubPreview({
      createAudioContext: () => first.context,
      fetchArrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    })

    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 1 })
    await scrub.scrub({ mediaId: 'audio-1', mediaUrl: 'blob:audio-1', timeSeconds: 2 })

    expect(first.source.stop).toHaveBeenCalledTimes(1)
  })
})
