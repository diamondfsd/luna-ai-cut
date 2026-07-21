import type { ColorMaskTrack, ColorMaskTrackKeyframe } from '../shared/colorMaskTypes'

export const MASK_TRACK_ALGORITHM_VERSION = 2

const IDENTITY_TRACK_KEYFRAME: ColorMaskTrackKeyframe = {
  time: 0,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotation: 0,
  confidence: 1,
}

export function normalizeMaskTrack(input: ColorMaskTrack | null | undefined): ColorMaskTrack | undefined {
  if (!input || input.version !== 1 || !Array.isArray(input.keyframes)) return undefined
  const keyframes = input.keyframes
    .map((keyframe) => ({
      time: Math.max(0, Number(keyframe.time) || 0),
      translateX: Math.max(-2, Math.min(2, Number(keyframe.translateX) || 0)),
      translateY: Math.max(-2, Math.min(2, Number(keyframe.translateY) || 0)),
      scale: Math.max(0.1, Math.min(10, Number(keyframe.scale) || 1)),
      rotation: Number(keyframe.rotation) || 0,
      confidence: Math.max(0, Math.min(1, Number(keyframe.confidence) || 0)),
      corrected: keyframe.corrected ? true : undefined,
    }))
    .sort((left, right) => left.time - right.time)
  if (keyframes.length === 0) return undefined
  return {
    version: 1,
    algorithmVersion: input.algorithmVersion === MASK_TRACK_ALGORITHM_VERSION ? MASK_TRACK_ALGORITHM_VERSION : undefined,
    anchorTime: Math.max(0, Number(input.anchorTime) || 0),
    startTime: keyframes[0].time,
    endTime: keyframes[keyframes.length - 1].time,
    keyframes,
  }
}

export function maskTrackTransformAt(track: ColorMaskTrack | null | undefined, time: number): ColorMaskTrackKeyframe {
  const normalized = normalizeMaskTrack(track)
  if (!normalized) return { ...IDENTITY_TRACK_KEYFRAME, time }
  const nextIndex = normalized.keyframes.findIndex((keyframe) => keyframe.time >= time)
  if (nextIndex <= 0) return { ...normalized.keyframes[Math.max(0, nextIndex)], time }
  if (nextIndex < 0) return { ...normalized.keyframes[normalized.keyframes.length - 1], time }
  const previous = normalized.keyframes[nextIndex - 1]
  const next = normalized.keyframes[nextIndex]
  const amount = (time - previous.time) / Math.max(0.000001, next.time - previous.time)
  return {
    time,
    translateX: previous.translateX + (next.translateX - previous.translateX) * amount,
    translateY: previous.translateY + (next.translateY - previous.translateY) * amount,
    scale: previous.scale + (next.scale - previous.scale) * amount,
    rotation: previous.rotation + (next.rotation - previous.rotation) * amount,
    confidence: previous.confidence + (next.confidence - previous.confidence) * amount,
  }
}

export function mergeMaskTrackSegment(
  existing: ColorMaskTrack | null | undefined,
  anchorTime: number,
  direction: 'forward' | 'backward',
  segment: ColorMaskTrackKeyframe[],
): ColorMaskTrack | undefined {
  const normalized = normalizeMaskTrack(existing)
  const retained = normalized?.keyframes.filter((keyframe) => direction === 'forward'
    ? keyframe.time < anchorTime - 0.000_001
    : keyframe.time > anchorTime + 0.000_001) ?? []
  return normalizeMaskTrack({
    version: 1,
    algorithmVersion: MASK_TRACK_ALGORITHM_VERSION,
    anchorTime: normalized?.anchorTime ?? anchorTime,
    startTime: 0,
    endTime: 0,
    keyframes: [...retained, ...segment],
  })
}
