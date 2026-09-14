export const DEFAULT_FRAME_RATE = 30

const MIN_FRAME_RATE = 1
const MAX_FRAME_RATE = 1_000
const EPSILON = 1e-7

export function normalizeFrameRate(value?: number | null): number {
  return Number.isFinite(value) && value! >= MIN_FRAME_RATE && value! <= MAX_FRAME_RATE
    ? value!
    : DEFAULT_FRAME_RATE
}

export function frameDuration(frameRate?: number | null): number {
  return 1 / normalizeFrameRate(frameRate)
}

export function frameIndexAtTime(time: number, frameRate?: number | null): number {
  const fps = normalizeFrameRate(frameRate)
  return Math.max(0, Math.round((Number.isFinite(time) ? time : 0) * fps))
}

export function timeAtFrame(frame: number, frameRate?: number | null): number {
  const fps = normalizeFrameRate(frameRate)
  const safeFrame = Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0))
  return Math.round((safeFrame / fps) * 1_000_000) / 1_000_000
}

export function sourceEndFrame(duration: number, frameRate?: number | null): number {
  const fps = normalizeFrameRate(frameRate)
  return Math.max(0, Math.floor((Number.isFinite(duration) ? duration : 0) * fps + EPSILON))
}

export function lastSourceFrameTime(duration: number, frameRate?: number | null): number {
  return timeAtFrame(Math.max(0, sourceEndFrame(duration, frameRate) - 1), frameRate)
}

export function snapTimeToFrame(
  time: number,
  frameRate?: number | null,
  duration?: number,
): number {
  const snapped = timeAtFrame(frameIndexAtTime(time, frameRate), frameRate)
  if (!Number.isFinite(duration)) return snapped
  return Math.max(0, Math.min(snapped, Math.max(0, duration!)))
}

export function minimumTrimFrameCount(frameRate?: number | null): number {
  return Math.max(1, Math.ceil(0.1 * normalizeFrameRate(frameRate) - EPSILON))
}

export function constrainTrimStart(
  time: number,
  endTime: number,
  duration: number,
  frameRate?: number | null,
): number {
  const fps = normalizeFrameRate(frameRate)
  const maxFrame = Math.max(0, frameIndexAtTime(endTime, fps) - minimumTrimFrameCount(fps))
  const next = timeAtFrame(Math.max(0, Math.min(frameIndexAtTime(time, fps), maxFrame)), fps)
  return Math.min(next, Math.max(0, duration))
}

export function constrainTrimEnd(
  time: number,
  startTime: number,
  duration: number,
  frameRate?: number | null,
): number {
  const fps = normalizeFrameRate(frameRate)
  const minFrame = frameIndexAtTime(startTime, fps) + minimumTrimFrameCount(fps)
  const maxFrame = sourceEndFrame(duration, fps)
  if (maxFrame <= 0) return 0
  const requestedFrame = frameIndexAtTime(time, fps)
  const nextFrame = maxFrame < minFrame
    ? maxFrame
    : Math.max(minFrame, Math.min(requestedFrame, maxFrame))
  return timeAtFrame(nextFrame, fps)
}

export function frameCountForDuration(
  duration: number,
  frameRate?: number | null,
  minimumSeconds = 0,
  maximumSeconds = Number.POSITIVE_INFINITY,
): number {
  const fps = normalizeFrameRate(frameRate)
  const minFrames = Math.max(1, Math.ceil(minimumSeconds * fps - EPSILON))
  const maxFrames = Math.max(minFrames, Math.floor(maximumSeconds * fps + EPSILON))
  const requestedFrames = Math.round((Number.isFinite(duration) ? duration : minimumSeconds) * fps)
  return Math.max(minFrames, Math.min(requestedFrames, maxFrames))
}
