export interface NormalizedStrokePoint {
  x: number
  y: number
}

interface InstanceStrokeSelectionInput {
  instanceIds: Uint16Array
  instanceWidth: number
  instanceHeight: number
  targetWidth: number
  targetHeight: number
  points: NormalizedStrokePoint[]
  strokeRadius?: number
  minimumHits?: number
  expansion?: number
}

export function decodeInstanceIds(buffer: ArrayBuffer): Uint16Array {
  if (buffer.byteLength % 2 !== 0) throw new Error('识别结果尺寸无效')
  const view = new DataView(buffer)
  const result = new Uint16Array(buffer.byteLength / 2)
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getUint16(index * 2, true)
  }
  return result
}

function markDisk(data: Uint8Array, width: number, height: number, x: number, y: number, radius: number): void {
  const left = Math.max(0, Math.floor(x - radius))
  const right = Math.min(width - 1, Math.ceil(x + radius))
  const top = Math.max(0, Math.floor(y - radius))
  const bottom = Math.min(height - 1, Math.ceil(y + radius))
  const radiusSquared = radius * radius
  for (let py = top; py <= bottom; py += 1) {
    for (let px = left; px <= right; px += 1) {
      if ((px - x) ** 2 + (py - y) ** 2 <= radiusSquared) data[py * width + px] = 1
    }
  }
}

export function rasterizeInstanceStroke(
  width: number,
  height: number,
  points: NormalizedStrokePoint[],
  radius = 4,
): Uint8Array {
  const raster = new Uint8Array(width * height)
  if (points.length === 0 || width <= 0 || height <= 0) return raster
  const toPixel = (point: NormalizedStrokePoint) => ({
    x: Math.max(0, Math.min(width - 1, point.x * width - 0.5)),
    y: Math.max(0, Math.min(height - 1, point.y * height - 0.5)),
  })
  let previous = toPixel(points[0])
  markDisk(raster, width, height, previous.x, previous.y, radius)
  for (const point of points.slice(1)) {
    const current = toPixel(point)
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y)
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.5)))
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      markDisk(
        raster,
        width,
        height,
        previous.x + (current.x - previous.x) * ratio,
        previous.y + (current.y - previous.y) * ratio,
        radius,
      )
    }
    previous = current
  }
  return raster
}

export function hardExpandMask(data: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(data)
  const horizontal = new Uint8Array(data.length)
  const result = new Uint8Array(data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let px = Math.max(0, x - radius); px <= Math.min(width - 1, x + radius); px += 1) {
        if (data[y * width + px] >= 128) {
          horizontal[y * width + x] = 255
          break
        }
      }
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let py = Math.max(0, y - radius); py <= Math.min(height - 1, y + radius); py += 1) {
        if (horizontal[py * width + x] !== 0) {
          result[y * width + x] = 255
          break
        }
      }
    }
  }
  return result
}

export function selectInstancesFromStroke(input: InstanceStrokeSelectionInput): Uint8Array | null {
  const {
    instanceIds,
    instanceWidth,
    instanceHeight,
    targetWidth,
    targetHeight,
    points,
    strokeRadius = 4,
    minimumHits = 3,
    expansion = 4,
  } = input
  if (instanceIds.length !== instanceWidth * instanceHeight || points.length < 2) return null
  const stroke = rasterizeInstanceStroke(instanceWidth, instanceHeight, points, strokeRadius)
  const hits = new Map<number, number>()
  for (let index = 0; index < stroke.length; index += 1) {
    const id = instanceIds[index]
    if (stroke[index] !== 0 && id !== 0) hits.set(id, (hits.get(id) ?? 0) + 1)
  }
  const selectedIds = new Set([...hits].filter(([, count]) => count >= minimumHits).map(([id]) => id))
  if (selectedIds.size === 0) return null
  const selected = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(instanceHeight - 1, Math.floor((y + 0.5) * instanceHeight / targetHeight))
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(instanceWidth - 1, Math.floor((x + 0.5) * instanceWidth / targetWidth))
      if (selectedIds.has(instanceIds[sourceY * instanceWidth + sourceX])) selected[y * targetWidth + x] = 255
    }
  }
  return hardExpandMask(selected, targetWidth, targetHeight, expansion)
}
