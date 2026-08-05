import type { ColorMaskTimeline } from '../shared/editPipeline'

export type MaskTimelineSample = ColorMaskTimeline['frames'][number]

/** Avoids requesting the exact media endpoint, where decoders do not return a frame. */
export function maskTimelineSampleTimes(duration: number, interval: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0]
  const safeInterval = Math.max(0.1, interval)
  const lastFrameTime = Math.max(0, duration - Math.min(0.05, duration / 2))
  const times: number[] = []
  for (let time = 0; time < lastFrameTime; time += safeInterval) {
    times.push(Number(time.toFixed(3)))
  }
  if (times.length === 0 || lastFrameTime - times[times.length - 1] > safeInterval * 0.25) {
    times.push(Number(lastFrameTime.toFixed(3)))
  }
  return times
}

export function normalizeMaskTimeline(
  input: ColorMaskTimeline | null | undefined,
): ColorMaskTimeline | undefined {
  if (!input || input.version !== 1 || !Array.isArray(input.frames)) return undefined
  const frames = input.frames
    .map((frame) => ({
      time: Math.max(0, Number(frame.time) || 0),
      ...(typeof frame.path === 'string' && frame.path ? { path: frame.path } : {}),
      ...(frame.transform ? {
        transform: {
          translateX: Math.max(-2, Math.min(2, Number(frame.transform.translateX) || 0)),
          translateY: Math.max(-2, Math.min(2, Number(frame.transform.translateY) || 0)),
          scale: Math.max(0.1, Math.min(10, Number(frame.transform.scale) || 1)),
          rotation: Number(frame.transform.rotation) || 0,
          confidence: Math.max(0, Math.min(1, Number(frame.transform.confidence) || 0)),
        },
      } : {}),
    }))
    .sort((left, right) => left.time - right.time)
  if (frames.length === 0) return undefined
  return {
    version: 1,
    startTime: frames[0].time,
    endTime: Math.max(frames[frames.length - 1].time, Number(input.endTime) || 0),
    sampleInterval: Math.max(0.05, Math.min(10, Number(input.sampleInterval) || 0.5)),
    frames,
  }
}

/** Each sample owns the interval halfway to its neighbors; invalid samples stay empty. */
export function maskTimelineSampleAt(
  timeline: ColorMaskTimeline | null | undefined,
  time: number,
): MaskTimelineSample | undefined {
  if (!timeline?.frames.length || time < timeline.startTime || time > timeline.endTime) return undefined
  let selected = timeline.frames[0]
  let distance = Math.abs(time - selected.time)
  for (let index = 1; index < timeline.frames.length; index += 1) {
    const candidate = timeline.frames[index]
    const nextDistance = Math.abs(time - candidate.time)
    if (nextDistance >= distance) break
    selected = candidate
    distance = nextDistance
  }
  return selected
}
