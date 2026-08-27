function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface WebGpuCubeLut {
  size: number
  rgba: Uint8Array
}

const MASK_DISTANCE_RANGE = 100
const DIAGONAL_DISTANCE = Math.SQRT2

function distanceToSelection(selected: Uint8Array, width: number, height: number): Float32Array {
  const distances = new Float32Array(width * height)
  for (let index = 0; index < distances.length; index += 1) {
    distances[index] = selected[index] ? 0 : MASK_DISTANCE_RANGE + DIAGONAL_DISTANCE
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      if (x > 0) distances[index] = Math.min(distances[index], distances[index - 1] + 1)
      if (y > 0) {
        distances[index] = Math.min(distances[index], distances[index - width] + 1)
        if (x > 0) distances[index] = Math.min(distances[index], distances[index - width - 1] + DIAGONAL_DISTANCE)
        if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index - width + 1] + DIAGONAL_DISTANCE)
      }
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x
      if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + 1] + 1)
      if (y + 1 < height) {
        distances[index] = Math.min(distances[index], distances[index + width] + 1)
        if (x > 0) distances[index] = Math.min(distances[index], distances[index + width - 1] + DIAGONAL_DISTANCE)
        if (x + 1 < width) distances[index] = Math.min(distances[index], distances[index + width + 1] + DIAGONAL_DISTANCE)
      }
    }
  }
  return distances
}

/** Encode grayscale masks into the R/G/B channels expected by the shared shader. */
export function encodeWebGpuColorMask(source: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = Math.max(0, width * height)
  const selected = new Uint8Array(pixelCount)
  for (let index = 0; index < pixelCount; index += 1) selected[index] = (source[index] ?? 0) >= 128 ? 1 : 0
  const normalDistances = distanceToSelection(selected, width, height)
  selected.forEach((value, index) => { selected[index] = value ? 0 : 1 })
  const invertedDistances = distanceToSelection(selected, width, height)
  const encoded = new Uint8Array(pixelCount * 4)
  for (let index = 0; index < pixelCount; index += 1) {
    encoded[index * 4] = source[index] ?? 0
    encoded[index * 4 + 1] = Math.round(Math.min(normalDistances[index], MASK_DISTANCE_RANGE) / MASK_DISTANCE_RANGE * 255)
    encoded[index * 4 + 2] = Math.round(Math.min(invertedDistances[index], MASK_DISTANCE_RANGE) / MASK_DISTANCE_RANGE * 255)
    encoded[index * 4 + 3] = 255
  }
  return encoded
}

export function parseWebGpuCube(data: string): WebGpuCubeLut {
  let size = 0
  const values: number[] = []
  for (const rawLine of data.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('LUT_3D_SIZE')) {
      size = Number.parseInt(line.slice('LUT_3D_SIZE'.length).trim(), 10)
      continue
    }
    if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX|LUT_1D_SIZE)/.test(line)) continue
    const parts = line.split(/\s+/)
    if (parts.length < 3) continue
    const rgb = parts.slice(0, 3).map(Number)
    if (rgb.some((value) => !Number.isFinite(value))) throw new Error('调色文件内容无效')
    values.push(...rgb)
  }
  if (size < 2 || size > 64 || values.length !== size ** 3 * 3) throw new Error('调色文件尺寸无效')
  const rgba = new Uint8Array(size ** 3 * 4)
  for (let index = 0; index < size ** 3; index += 1) {
    rgba[index * 4] = Math.round(clamp(values[index * 3], 0, 1) * 255)
    rgba[index * 4 + 1] = Math.round(clamp(values[index * 3 + 1], 0, 1) * 255)
    rgba[index * 4 + 2] = Math.round(clamp(values[index * 3 + 2], 0, 1) * 255)
    rgba[index * 4 + 3] = 255
  }
  return { size, rgba }
}
