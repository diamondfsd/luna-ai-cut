import type { LiveStreamAudioInputFrame } from '../../../src/shared/types'

export const LIVE_STREAM_INPUT_SAMPLE_RATE = 48_000
export const LIVE_STREAM_INPUT_CHANNELS = 1

function clampSample(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)))
}

export function normalizeLiveStreamPcm(frame: LiveStreamAudioInputFrame): Buffer | null {
  const sampleRate = Math.round(frame.sampleRate)
  const channels = Math.round(frame.channels)
  const sampleCount = Math.round(frame.sampleCount)
  const source = Buffer.from(frame.pcm16Le)
  if (sampleRate <= 0 || channels <= 0 || sampleCount <= 0 || source.length !== sampleCount * channels * 2) {
    return null
  }
  if (sampleRate === LIVE_STREAM_INPUT_SAMPLE_RATE && channels === LIVE_STREAM_INPUT_CHANNELS) return source

  const outputSampleCount = Math.max(1, Math.round(sampleCount * LIVE_STREAM_INPUT_SAMPLE_RATE / sampleRate))
  const output = Buffer.allocUnsafe(outputSampleCount * LIVE_STREAM_INPUT_CHANNELS * 2)
  for (let outputIndex = 0; outputIndex < outputSampleCount; outputIndex += 1) {
    const sourcePosition = outputIndex * sampleRate / LIVE_STREAM_INPUT_SAMPLE_RATE
    const firstIndex = Math.min(sampleCount - 1, Math.floor(sourcePosition))
    const secondIndex = Math.min(sampleCount - 1, firstIndex + 1)
    const mix = sourcePosition - firstIndex
    let sample = 0
    for (let channel = 0; channel < channels; channel += 1) {
      const first = source.readInt16LE((firstIndex * channels + channel) * 2)
      const second = source.readInt16LE((secondIndex * channels + channel) * 2)
      sample += first + (second - first) * mix
    }
    output.writeInt16LE(clampSample(sample / channels), outputIndex * 2)
  }
  return output
}
