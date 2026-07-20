export function drawMaskSelectionBoundary(
  context: CanvasRenderingContext2D,
  mask: Float32Array,
  width: number,
  height: number,
  threshold = 127.5,
): void {
  const selected = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] >= threshold
  const boundary = new Path2D()
  const whiteDashes = new Path2D()
  const addEdge = (x1: number, y1: number, x2: number, y2: number, white: boolean): void => {
    boundary.moveTo(x1, y1)
    boundary.lineTo(x2, y2)
    if (!white) return
    whiteDashes.moveTo(x1, y1)
    whiteDashes.lineTo(x2, y2)
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!selected(x, y)) continue
      const horizontalDash = Math.floor(x / 4) % 2 === 0
      const verticalDash = Math.floor(y / 4) % 2 === 0
      if (!selected(x, y - 1)) addEdge(x, y, x + 1, y, horizontalDash)
      if (!selected(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1, verticalDash)
      if (!selected(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1, horizontalDash)
      if (!selected(x - 1, y)) addEdge(x, y + 1, x, y, verticalDash)
    }
  }
  context.save()
  context.strokeStyle = 'rgba(0, 0, 0, 0.9)'
  context.lineWidth = 2.5
  context.stroke(boundary)
  context.strokeStyle = '#ffffff'
  context.lineWidth = 1.25
  context.stroke(whiteDashes)
  context.restore()
}
