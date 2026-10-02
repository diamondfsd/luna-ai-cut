import type { LiveWindowResolution } from '../../src/shared/types/liveStream'

interface WorkAreaSize {
  width: number
  height: number
}

export function liveWindowContentSize(
  _resolution: LiveWindowResolution,
  workArea: WorkAreaSize,
  sourceAspectRatio = 16 / 9,
): WorkAreaSize {
  const targetLongSide = 1280
  const aspectRatio = Number.isFinite(sourceAspectRatio) && sourceAspectRatio > 0
    ? sourceAspectRatio
    : 16 / 9
  const target = aspectRatio >= 1
    ? { width: targetLongSide, height: targetLongSide / aspectRatio }
    : { width: targetLongSide * aspectRatio, height: targetLongSide }
  // Electron window bounds use DIP, so display scale must not shrink the visible window.
  const targetWidth = target.width
  const targetHeight = target.height
  const availableWidth = Math.max(320, workArea.width - 32)
  const availableHeight = Math.max(180, workArea.height - 32)
  const fit = Math.min(1, availableWidth / targetWidth, availableHeight / targetHeight)

  return {
    width: Math.max(320, Math.floor(targetWidth * fit)),
    height: Math.max(180, Math.floor(targetHeight * fit)),
  }
}
