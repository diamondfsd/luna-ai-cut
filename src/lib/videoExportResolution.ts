import type { VideoResolution } from '../shared/types'

export interface VideoDimensions {
  width: number
  height: number
}

function evenDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 2
  return Math.max(2, Math.floor(value / 2) * 2)
}

export function normalizeVideoDimensions(width: number, height: number): VideoDimensions {
  return {
    width: evenDimension(width),
    height: evenDimension(height),
  }
}

export function resolveVideoExportResolution(
  originalWidth: number,
  originalHeight: number,
  resolution: VideoResolution | undefined,
): VideoDimensions {
  if (resolution === 'original' || resolution === undefined) {
    return normalizeVideoDimensions(originalWidth, originalHeight)
  }

  const aspect = originalWidth / originalHeight
  switch (resolution) {
    case '1080p':
      return normalizeVideoDimensions(Math.round(1080 * aspect), 1080)
    case '2k':
      return normalizeVideoDimensions(2560, Math.round(2560 / aspect))
    case '4k':
      return normalizeVideoDimensions(3840, Math.round(3840 / aspect))
    default:
      return normalizeVideoDimensions(originalWidth, originalHeight)
  }
}
