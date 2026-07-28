import { erodeMaskOnePixel } from '../pixel-stretch/pixelStretchLayers'

const GAUSSIAN_KERNEL = [1, 4, 6, 4, 1] as const
const GAUSSIAN_WEIGHT = 16
const GAUSSIAN_RADIUS = 2

function blurPass(
  source: Float32Array,
  width: number,
  height: number,
  horizontal: boolean,
): Float32Array {
  const output = new Float32Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0
      for (let offset = -GAUSSIAN_RADIUS; offset <= GAUSSIAN_RADIUS; offset += 1) {
        const sampleX = horizontal ? Math.max(0, Math.min(width - 1, x + offset)) : x
        const sampleY = horizontal ? y : Math.max(0, Math.min(height - 1, y + offset))
        sum += source[sampleY * width + sampleX] * GAUSSIAN_KERNEL[offset + GAUSSIAN_RADIUS]
      }
      output[y * width + x] = sum / GAUSSIAN_WEIGHT
    }
  }
  return output
}

/** Removes background color spill, then creates one continuous edge shared by both effect layers. */
export function refineOnlyYourColorMask(data: Uint8Array, width: number, height: number): Uint8Array {
  const eroded = erodeMaskOnePixel(data, width, height)
  if (eroded.length === 0) return eroded
  const horizontal = blurPass(Float32Array.from(eroded), width, height, true)
  const softened = blurPass(horizontal, width, height, false)
  return Uint8Array.from(softened, (value) => Math.round(value))
}
