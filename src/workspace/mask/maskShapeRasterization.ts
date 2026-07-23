export type MaskShapeKind = 'rectangle' | 'ellipse'

export interface MaskShapeBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export function shapeBoundsFromDrag(
  start: { x: number; y: number },
  current: { x: number; y: number },
  options: { centered: boolean; constrained: boolean },
): MaskShapeBounds {
  let deltaX = current.x - start.x
  let deltaY = current.y - start.y
  if (options.constrained) {
    const extent = Math.max(Math.abs(deltaX), Math.abs(deltaY))
    deltaX = Math.sign(deltaX || 1) * extent
    deltaY = Math.sign(deltaY || 1) * extent
  }
  const opposite = options.centered
    ? { x: start.x - deltaX, y: start.y - deltaY }
    : start
  const endpoint = { x: start.x + deltaX, y: start.y + deltaY }
  return {
    left: Math.min(opposite.x, endpoint.x),
    top: Math.min(opposite.y, endpoint.y),
    right: Math.max(opposite.x, endpoint.x),
    bottom: Math.max(opposite.y, endpoint.y),
  }
}

export function rasterizeShapeMask(
  width: number,
  height: number,
  kind: MaskShapeKind,
  bounds: MaskShapeBounds,
): Uint8Array {
  const result = new Uint8Array(width * height)
  const shapeWidth = bounds.right - bounds.left
  const shapeHeight = bounds.bottom - bounds.top
  if (shapeWidth < 0.5 || shapeHeight < 0.5) return result

  const minX = Math.max(0, Math.floor(bounds.left))
  const maxX = Math.min(width - 1, Math.ceil(bounds.right) - 1)
  const minY = Math.max(0, Math.floor(bounds.top))
  const maxY = Math.min(height - 1, Math.ceil(bounds.bottom) - 1)
  const centerX = (bounds.left + bounds.right) / 2
  const centerY = (bounds.top + bounds.bottom) / 2
  const radiusX = shapeWidth / 2
  const radiusY = shapeHeight / 2

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const inside = kind === 'rectangle' || (
        ((x + 0.5 - centerX) / radiusX) ** 2
        + ((y + 0.5 - centerY) / radiusY) ** 2 <= 1
      )
      if (inside) result[y * width + x] = 255
    }
  }
  return result
}
