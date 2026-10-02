const DEFAULT_FRAME_RATE = 30
const MIN_END_MARGIN_SECONDS = 0.1

export function resolveLivePhotoCoverTime(
  segmentStart: number,
  segmentDuration: number,
  requestedTime: number,
  fps: number | null | undefined,
): number {
  const duration = Math.max(0, segmentDuration)
  const frameRate = fps && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FRAME_RATE
  const endMargin = Math.min(duration, Math.max(MIN_END_MARGIN_SECONDS, 2 / frameRate))
  const latestTime = segmentStart + Math.max(0, duration - endMargin)
  return Math.min(latestTime, Math.max(segmentStart, requestedTime))
}
