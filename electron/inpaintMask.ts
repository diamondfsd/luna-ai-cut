export const INPAINT_MODEL_SIZE = 512

export interface InpaintRegion {
  x: number
  y: number
  size: number
}

interface MaskBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function selectedMaskBounds(input: Uint8Array, width: number, height: number): MaskBounds | null {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (input[y * width + x] < 16) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  return right < left ? null : { left, top, right, bottom }
}

function placeRegionAxis(center: number, size: number, sourceSize: number): number {
  const preferred = Math.round(center - size / 2)
  const min = Math.min(0, sourceSize - size)
  const max = Math.max(0, sourceSize - size)
  return Math.max(min, Math.min(max, preferred))
}

export function createInpaintRegion(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): InpaintRegion {
  const bounds = selectedMaskBounds(mask, maskWidth, maskHeight)
  if (!bounds) throw new Error('请先选择要消除的区域')
  const left = Math.floor(bounds.left * sourceWidth / maskWidth)
  const top = Math.floor(bounds.top * sourceHeight / maskHeight)
  const right = Math.ceil((bounds.right + 1) * sourceWidth / maskWidth)
  const bottom = Math.ceil((bounds.bottom + 1) * sourceHeight / maskHeight)
  const span = Math.max(right - left, bottom - top)
  const size = Math.min(Math.max(sourceWidth, sourceHeight), Math.max(INPAINT_MODEL_SIZE, Math.ceil(span * 3)))
  return {
    x: placeRegionAxis((left + right) / 2, size, sourceWidth),
    y: placeRegionAxis((top + bottom) / 2, size, sourceHeight),
    size,
  }
}

function bilinearSample(input: Uint8Array, width: number, height: number, x: number, y: number, channels: number, channel = 0): number {
  const clampedX = Math.max(0, Math.min(width - 1, x))
  const clampedY = Math.max(0, Math.min(height - 1, y))
  const x0 = Math.floor(clampedX)
  const y0 = Math.floor(clampedY)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = clampedX - x0
  const fy = clampedY - y0
  const top = input[(y0 * width + x0) * channels + channel] * (1 - fx) + input[(y0 * width + x1) * channels + channel] * fx
  const bottom = input[(y1 * width + x0) * channels + channel] * (1 - fx) + input[(y1 * width + x1) * channels + channel] * fx
  return top * (1 - fy) + bottom * fy
}

export function prepareInpaintInputs(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  region: InpaintRegion,
): { rgb: Buffer; mask: Uint8Array } {
  const rgb = Buffer.allocUnsafe(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3)
  const modelMask = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE)
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) {
    const sourceY = region.y + (y + 0.5) * region.size / INPAINT_MODEL_SIZE - 0.5
    for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
      const sourceX = region.x + (x + 0.5) * region.size / INPAINT_MODEL_SIZE - 0.5
      const pixel = y * INPAINT_MODEL_SIZE + x
      for (let channel = 0; channel < 3; channel++) {
        rgb[pixel * 3 + channel] = Math.round(bilinearSample(source, sourceWidth, sourceHeight, sourceX, sourceY, 3, channel))
      }
      if (sourceX < 0 || sourceX >= sourceWidth || sourceY < 0 || sourceY >= sourceHeight) continue
      const maskX = Math.max(0, Math.min(maskWidth - 1, Math.floor((sourceX + 0.5) * maskWidth / sourceWidth)))
      const maskY = Math.max(0, Math.min(maskHeight - 1, Math.floor((sourceY + 0.5) * maskHeight / sourceHeight)))
      modelMask[pixel] = mask[maskY * maskWidth + maskX] >= 16 ? 255 : 0
    }
  }
  return { rgb, mask: modelMask }
}

export function modelRadiusForSourcePixels(sourcePixels: number, region: InpaintRegion): number {
  if (sourcePixels <= 0) return 0
  return Math.max(1, Math.round(sourcePixels * INPAINT_MODEL_SIZE / region.size))
}

export function compositeInpaintRegion(
  source: Buffer,
  sourceWidth: number,
  sourceHeight: number,
  generated: Uint8Array,
  alpha: Uint8Array,
  region: InpaintRegion,
): Buffer {
  const output = Buffer.from(source)
  const startX = Math.max(0, region.x)
  const startY = Math.max(0, region.y)
  const endX = Math.min(sourceWidth, region.x + region.size)
  const endY = Math.min(sourceHeight, region.y + region.size)
  for (let y = startY; y < endY; y++) {
    const modelY = (y - region.y + 0.5) * INPAINT_MODEL_SIZE / region.size - 0.5
    for (let x = startX; x < endX; x++) {
      const modelX = (x - region.x + 0.5) * INPAINT_MODEL_SIZE / region.size - 0.5
      const mix = bilinearSample(alpha, INPAINT_MODEL_SIZE, INPAINT_MODEL_SIZE, modelX, modelY, 1) / 255
      if (mix <= 0) continue
      const outputPixel = (y * sourceWidth + x) * 3
      for (let channel = 0; channel < 3; channel++) {
        const replacement = bilinearSample(generated, INPAINT_MODEL_SIZE, INPAINT_MODEL_SIZE, modelX, modelY, 3, channel)
        output[outputPixel + channel] = Math.round(source[outputPixel + channel] * (1 - mix) + replacement * mix)
      }
    }
  }
  return output
}

export function resampleInpaintMask(input: Uint8Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE)
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) {
    const sourceY = Math.min(height - 1, Math.floor(y * height / INPAINT_MODEL_SIZE))
    for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
      const sourceX = Math.min(width - 1, Math.floor(x * width / INPAINT_MODEL_SIZE))
      output[y * INPAINT_MODEL_SIZE + x] = input[sourceY * width + sourceX] >= 16 ? 255 : 0
    }
  }
  return output
}

export function dilateInpaintMask(input: Uint8Array, radius: number): Uint8Array {
  if (radius <= 0) return input.slice()
  const horizontal = new Uint8Array(input.length)
  const output = new Uint8Array(input.length)
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    for (let dx = -radius; dx <= radius; dx++) if (input[y * INPAINT_MODEL_SIZE + Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, x + dx))]) { horizontal[y * INPAINT_MODEL_SIZE + x] = 255; break }
  }
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    for (let dy = -radius; dy <= radius; dy++) if (horizontal[Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, y + dy)) * INPAINT_MODEL_SIZE + x]) { output[y * INPAINT_MODEL_SIZE + x] = 255; break }
  }
  return output
}

export function featherInpaintMask(input: Uint8Array, radius: number): Uint8Array {
  if (radius <= 0) return input.slice()
  const horizontal = new Uint8Array(input.length)
  const output = new Uint8Array(input.length)
  const size = radius * 2 + 1
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    let sum = 0
    for (let dx = -radius; dx <= radius; dx++) sum += input[y * INPAINT_MODEL_SIZE + Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, x + dx))]
    horizontal[y * INPAINT_MODEL_SIZE + x] = Math.round(sum / size)
  }
  for (let y = 0; y < INPAINT_MODEL_SIZE; y++) for (let x = 0; x < INPAINT_MODEL_SIZE; x++) {
    let sum = 0
    for (let dy = -radius; dy <= radius; dy++) sum += horizontal[Math.max(0, Math.min(INPAINT_MODEL_SIZE - 1, y + dy)) * INPAINT_MODEL_SIZE + x]
    output[y * INPAINT_MODEL_SIZE + x] = Math.round(sum / size)
  }
  return output
}
