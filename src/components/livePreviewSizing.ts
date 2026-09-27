export interface LivePreviewSize {
  width: number
  height: number
}

export function livePreviewOutputSize(
  sourceWidth: number,
  sourceHeight: number,
): LivePreviewSize {
  const width = Math.max(1, Math.round(sourceWidth))
  const height = Math.max(1, Math.round(sourceHeight))
  const targetLongSide = 1280

  return width >= height
    ? { width: targetLongSide, height: Math.max(1, Math.round(targetLongSide * height / width)) }
    : { width: Math.max(1, Math.round(targetLongSide * width / height)), height: targetLongSide }
}
