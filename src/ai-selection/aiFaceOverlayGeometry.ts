export interface NormalizedFaceBounds {
  x: number
  y: number
  width: number
  height: number
}

export function coverFittedFaceBounds(
  bounds: NormalizedFaceBounds,
  sourceWidth: number,
  sourceHeight: number,
  frameAspectRatio = 4 / 3,
): NormalizedFaceBounds {
  const sourceAspectRatio = sourceWidth / sourceHeight
  const imageWidth = sourceAspectRatio > frameAspectRatio ? sourceAspectRatio / frameAspectRatio : 1
  const imageHeight = sourceAspectRatio > frameAspectRatio ? 1 : frameAspectRatio / sourceAspectRatio
  return {
    x: (1 - imageWidth) / 2 + bounds.x * imageWidth,
    y: (1 - imageHeight) / 2 + bounds.y * imageHeight,
    width: bounds.width * imageWidth,
    height: bounds.height * imageHeight,
  }
}
