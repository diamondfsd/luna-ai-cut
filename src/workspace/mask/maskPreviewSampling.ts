const FEATHER_WEIGHTS = [1, 4, 6, 4, 1] as const
const FEATHER_WEIGHT_TOTAL = 16

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
  const stepX = feather * 0.5 / Math.max(sourcePixelsPerPreviewPixelX, 0.0001)
  const stepY = feather * 0.5 / Math.max(sourcePixelsPerPreviewPixelY, 0.0001)
  const horizontal = new Float32Array(data.length)
  const output = new Float32Array(data.length)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let tap = 0; tap < FEATHER_WEIGHTS.length; tap += 1) {
        value += sampleScalarBilinear(data, width, height, x + (tap - 2) * stepX, y) * FEATHER_WEIGHTS[tap]
      }
      horizontal[y * width + x] = value / FEATHER_WEIGHT_TOTAL
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0
      for (let tap = 0; tap < FEATHER_WEIGHTS.length; tap += 1) {
        value += sampleScalarBilinear(horizontal, width, height, x, y + (tap - 2) * stepY) * FEATHER_WEIGHTS[tap]
      }
      output[y * width + x] = value / FEATHER_WEIGHT_TOTAL
    }
  }
  return output
}
