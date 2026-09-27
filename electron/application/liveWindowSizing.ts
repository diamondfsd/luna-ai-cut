import type { LiveWindowResolution } from '../../src/shared/types/liveStream'

interface WorkAreaSize {
  width: number
  height: number
}

export function liveWindowContentSize(
  resolution: LiveWindowResolution,
  scaleFactor: number,
  workArea: WorkAreaSize,
  sourceAspectRatio = 16 / 9,
): WorkAreaSize {
  const targetLongSide = resolution === '1080p' ? 1920 : 1280
  const aspectRatio = Number.isFinite(sourceAspectRatio) && sourceAspectRatio > 0
    ? sourceAspectRatio
    : 16 / 9
  const target = aspectRatio >= 1
    ? { width: targetLongSide, height: targetLongSide / aspectRatio }
    : { width: targetLongSide * aspectRatio, height: targetLongSide }
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1
  const targetWidth = target.width / scale
  const targetHeight = target.height / scale
  const availableWidth = Math.max(320, workArea.width - 32)
  const availableHeight = Math.max(180, workArea.height - 88)
  const fit = Math.min(1, availableWidth / targetWidth, availableHeight / targetHeight)

  return {
    width: Math.max(320, Math.floor(targetWidth * fit)),
    height: Math.max(180, Math.floor(targetHeight * fit)),
  }
}
