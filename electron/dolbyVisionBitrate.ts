const DEFAULT_DOLBY_VISION_BITRATE = 40_000_000
const MIN_DOLBY_VISION_BITRATE = 10_000_000

export function resolveDolbyVisionBitrate(streamBitrate?: string, formatBitrate?: string): number {
  const streamValue = Number(streamBitrate)
  const formatValue = Number(formatBitrate)
  const detected = Number.isFinite(streamValue) && streamValue > 0
    ? streamValue
    : Number.isFinite(formatValue) && formatValue > 0
      ? formatValue
      : DEFAULT_DOLBY_VISION_BITRATE
  return Math.max(MIN_DOLBY_VISION_BITRATE, Math.round(detected))
}
