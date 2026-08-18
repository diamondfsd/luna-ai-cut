const DEFAULT_DOLBY_VISION_BITRATE = 40_000_000
const MIN_DOLBY_VISION_BITRATE = 10_000_000

export function resolveDolbyVisionBitrate(
  streamBitrate?: string,
  formatBitrate?: string,
  formatSize?: string,
  duration?: string,
): number {
  const streamValue = Number(streamBitrate)
  const formatValue = Number(formatBitrate)
  const sizeValue = Number(formatSize)
  const durationValue = Number(duration)
  const sizeDerivedValue = Number.isFinite(sizeValue) && sizeValue > 0
    && Number.isFinite(durationValue) && durationValue > 0
    ? sizeValue * 8 / durationValue
    : 0
  const detected = Number.isFinite(streamValue) && streamValue > 0
    ? streamValue
    : Number.isFinite(formatValue) && formatValue > 0
      ? formatValue
      : sizeDerivedValue > 0
        ? sizeDerivedValue
        : DEFAULT_DOLBY_VISION_BITRATE
  return Math.max(MIN_DOLBY_VISION_BITRATE, Math.round(detected))
}
