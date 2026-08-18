export interface WebGpuMaskSource {
  width: number
  height: number
  bytes: Uint8Array
}

export interface WebGpuMaskTextureData {
  data: Uint8Array
  bytesPerRow: number
}

const MASK_DISTANCE_RANGE = 100
const DIAGONAL_DISTANCE = Math.SQRT2

function distanceToSelection(selected: Uint8Array, width: number, height: number): Float32Array {
  const distances = new Float32Array(selected.length)
  for (let index = 0; index < selected.length; index += 1) {
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

function encodeDistanceChannel(distances: Float32Array, index: number): number {
  return Math.round(Math.min(distances[index], MASK_DISTANCE_RANGE) / MASK_DISTANCE_RANGE * 255)
}

/**
 * Converts the grayscale PGM mask into R=mask, G=normal distance and
 * B=inverted distance, matching the WebGPU composition feathering data.
 */
export function encodeWebGpuMaskTexture(source: WebGpuMaskSource): WebGpuMaskTextureData {
  const width = Math.floor(source.width)
  const height = Math.floor(source.height)
  if (width < 1 || height < 1 || source.bytes.length !== width * height) {
    throw new Error('蒙版尺寸或数据无效')
  }

  const selected = new Uint8Array(source.bytes.length)
  for (let index = 0; index < source.bytes.length; index += 1) {
    selected[index] = source.bytes[index] >= 128 ? 1 : 0
  }
  const normalDistances = distanceToSelection(selected, width, height)
  const invertedSelection = new Uint8Array(selected.length)
  for (let index = 0; index < selected.length; index += 1) {
    invertedSelection[index] = selected[index] ? 0 : 1
  }
  const invertedDistances = distanceToSelection(invertedSelection, width, height)
  const rowBytes = width * 4
  const bytesPerRow = Math.ceil(rowBytes / 256) * 256
  const data = new Uint8Array(bytesPerRow * height)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const offset = y * bytesPerRow + x * 4
      data[offset] = source.bytes[index]
      data[offset + 1] = encodeDistanceChannel(normalDistances, index)
      data[offset + 2] = encodeDistanceChannel(invertedDistances, index)
      data[offset + 3] = 255
    }
  }
  return { data, bytesPerRow }
}
