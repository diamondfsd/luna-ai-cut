export interface ViewportOffset {
  x: number
  y: number
}

/**
 * Returns the new viewport offset for a zoom whose anchor is relative to the
 * untransformed viewport center.
 */
export function zoomOffsetAroundPoint(
  current: ViewportOffset,
  currentScale: number,
  nextScale: number,
  anchorX: number,
  anchorY: number,
): ViewportOffset {
  const scaleRatio = nextScale / currentScale
  return {
    x: current.x + (anchorX - current.x) * (1 - scaleRatio),
    y: current.y + (anchorY - current.y) * (1 - scaleRatio),
  }
}
