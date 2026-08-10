export interface AiAvatarCropBounds {
  x: number
  y: number
  width: number
  height: number
}

export function squareCropAroundCenter(
  bounds: AiAvatarCropBounds,
  sourceWidth: number,
  sourceHeight: number,
  contextScale = 1,
): AiAvatarCropBounds {
  const width = Math.max(1, sourceWidth)
  const height = Math.max(1, sourceHeight)
  const sidePixels = Math.min(width, height, Math.max(bounds.width * width, bounds.height * height) * contextScale)
  const cropWidth = sidePixels / width
  const cropHeight = sidePixels / height
  const centerX = bounds.x + bounds.width / 2
  const centerY = bounds.y + bounds.height / 2
  return {
    x: Math.max(0, Math.min(1 - cropWidth, centerX - cropWidth / 2)),
    y: Math.max(0, Math.min(1 - cropHeight, centerY - cropHeight / 2)),
    width: cropWidth,
    height: cropHeight,
  }
}
