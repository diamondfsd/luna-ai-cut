import type { LiveWindowResolution } from '../shared/types/liveStream'

export interface LivePreviewSize {
  width: number
  height: number
}

export function livePreviewOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  resolution: LiveWindowResolution,
): LivePreviewSize {
  const width = Math.max(1, Math.round(sourceWidth))
  const height = Math.max(1, Math.round(sourceHeight))
  const targetLongSide = resolution === '1080p' ? 1920 : 1280

  return width >= height
    ? { width: targetLongSide, height: Math.max(1, Math.round(targetLongSide * height / width)) }
    : { width: Math.max(1, Math.round(targetLongSide * width / height)), height: targetLongSide }
}
