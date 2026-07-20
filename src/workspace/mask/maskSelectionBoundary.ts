interface BoundaryEdge {
  startX: number
  startY: number
  endX: number
  endY: number
  used: boolean
}

function pointKey(x: number, y: number): string {
  return `${x}:${y}`
}

export function createMaskSelectionBoundary(
  mask: Float32Array,
  width: number,
  height: number,
  threshold = 127.5,
): Path2D {
  const edges: BoundaryEdge[] = []
  const starts = new Map<string, BoundaryEdge[]>()
  const selected = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] >= threshold
  const addEdge = (startX: number, startY: number, endX: number, endY: number): void => {
    const edge = { startX, startY, endX, endY, used: false }
    edges.push(edge)
    const key = pointKey(startX, startY)
    const bucket = starts.get(key) ?? []
    bucket.push(edge)
    starts.set(key, bucket)
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!selected(x, y)) continue
      if (!selected(x, y - 1)) addEdge(x, y, x + 1, y)
      if (!selected(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1)
      if (!selected(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1)
      if (!selected(x - 1, y)) addEdge(x, y + 1, x, y)
    }
  }
  const path = new Path2D()
  for (const first of edges) {
    if (first.used) continue
    path.moveTo(first.startX, first.startY)
    let edge: BoundaryEdge | undefined = first
    while (edge && !edge.used) {
      edge.used = true
      path.lineTo(edge.endX, edge.endY)
      edge = starts.get(pointKey(edge.endX, edge.endY))?.find((candidate) => !candidate.used)
    }
  }
  return path
}

export function drawMaskSelectionBoundary(context: CanvasRenderingContext2D, path: Path2D, offset: number, scale = 1): void {
  context.save()
  context.lineCap = 'butt'
  context.lineJoin = 'miter'
  context.strokeStyle = 'rgba(0, 0, 0, 0.95)'
  context.lineWidth = 1.35 * scale
  context.stroke(path)
  context.strokeStyle = 'rgba(255, 255, 255, 0.98)'
  context.lineWidth = 0.7 * scale
  context.setLineDash([4 * scale, 4 * scale])
  context.lineDashOffset = offset * scale
  context.stroke(path)
  context.restore()
}
