function sampleScalarBilinear(
  data: ArrayLike<number>,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const sourceX = Math.max(0, Math.min(width - 1, x))
  const sourceY = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(sourceX)
  const y0 = Math.floor(sourceY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const tx = sourceX - x0
  const ty = sourceY - y0
  const top = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx
  const bottom = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx
  return top * (1 - ty) + bottom * ty
}

export function sampleMaskBilinear(
  data: Uint8Array,
  width: number,
  height: number,
  normalizedX: number,
  normalizedY: number,
): number {
  return sampleScalarBilinear(
    data,
    width,
    height,
    normalizedX * width - 0.5,
    normalizedY * height - 0.5,
  )
}

export function featherMaskPreview(
  data: Float32Array,
  width: number,
  height: number,
  feather: number,
  sourcePixelsPerPreviewPixelX: number,
  sourcePixelsPerPreviewPixelY: number,
): Float32Array {
  if (feather < 0.5 || width <= 0 || height <= 0) return data.slice()
  const stepX = Math.max(sourcePixelsPerPreviewPixelX, 0.0001)
  const stepY = Math.max(sourcePixelsPerPreviewPixelY, 0.0001)
  const diagonal = Math.hypot(stepX, stepY)
  const limit = feather + diagonal
  const distances = new Float32Array(data.length)
  const output = new Float32Array(data.length)
  distances.fill(limit)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (data[index] >= 127.5) distances[index] = 0
      if (x > 0) distances[index] = Math.min(distances[index], distances[index - 1] + stepX)
      if (y > 0) {
        distances[index] = Math.min(distances[index], distances[index - width] + stepY)
        if (x > 0) distances[index] = Math.min(distances[index], distances[index - width - 1] + diagonal)
        if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index - width + 1] + diagonal)
      }
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x
      if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + 1] + stepX)
      if (y + 1 < height) {
        distances[index] = Math.min(distances[index], distances[index + width] + stepY)
        if (x > 0) distances[index] = Math.min(distances[index], distances[index + width - 1] + diagonal)
        if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + width + 1] + diagonal)
      }
      const normalizedDistance = Math.max(0, Math.min(1, distances[index] / feather))
      const smoothDistance = normalizedDistance * normalizedDistance * (3 - 2 * normalizedDistance)
      output[index] = Math.max(data[index], 255 * (1 - smoothDistance))
    }
  }
  return output
}
