import type { EditProjectClip } from './types/aiEditing.ts'

function curveIntegral(points: Array<{ u: number; speed: number }>, interpolation: 'linear' | 'smooth', endU: number): number {
  const end = Math.max(0, Math.min(1, endU))
  let total = 0
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!
    const b = points[index]!
    const segmentEnd = Math.min(end, b.u)
    if (segmentEnd <= a.u) break
    const width = b.u - a.u
    const du = segmentEnd - a.u
    const t = du / width
    const blendIntegral = interpolation === 'smooth' ? t * t * t - t * t * t * t / 2 : t * t / 2
    total += a.speed * du + (b.speed - a.speed) * width * blendIntegral
    if (segmentEnd >= end) break
  }
  return total
}

export function clipAverageSpeed(clip: EditProjectClip): number {
  const curve = clip.speedCurve
  if (!curve) return 1
  return curveIntegral(curve.points, curve.interpolation, 1)
}

export function clipOutputDurationMs(clip: EditProjectClip): number {
  return Math.max(1, Math.round((clip.sourceEndMs - clip.sourceStartMs) / clipAverageSpeed(clip)))
}

export function clipSourceOffsetAtOutputMs(clip: EditProjectClip, outputOffsetMs: number): number {
  const sourceDuration = clip.sourceEndMs - clip.sourceStartMs
  if (!clip.speedCurve) return Math.max(0, Math.min(sourceDuration, outputOffsetMs))
  const outputDuration = clipOutputDurationMs(clip)
  const u = Math.max(0, Math.min(1, outputOffsetMs / outputDuration))
  const sourceFraction = curveIntegral(clip.speedCurve.points, clip.speedCurve.interpolation, u) / clipAverageSpeed(clip)
  return Math.max(0, Math.min(sourceDuration, Math.round(sourceFraction * sourceDuration)))
}

export function orderedTimelineClips(clips: EditProjectClip[]): EditProjectClip[] {
  let timelineStartMs = 0
  return [...clips].map(clip => {
    const next = { ...clip, timelineStartMs }
    timelineStartMs += clipOutputDurationMs(clip)
    return next
  })
}
