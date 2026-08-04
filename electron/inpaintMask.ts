export const INPAINT_MODEL_SIZE = 512

export interface InpaintRegion {
  x: number
  y: number
  size: number
}

export interface InpaintMaskJob {
  mask: Uint8Array
  region: InpaintRegion
}

interface MaskBounds {
  left: number
  top: number
  right: number
  bottom: number
}

interface MaskComponent {
  bounds: MaskBounds
  pixels: number[]
}

const MAX_SPLIT_COMPONENTS = 64
const MAX_REFINEMENT_JOBS = 8
const REFINEMENT_REGION_THRESHOLD = 640
const REFINEMENT_CONTEXT_FACTOR = 1.4

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

function connectedMaskComponents(input: Uint8Array, width: number, height: number): MaskComponent[] | null {
  const visited = new Uint8Array(input.length)
  const queue = new Int32Array(input.length)
  const components: MaskComponent[] = []
  for (let start = 0; start < input.length; start++) {
    if (visited[start] || input[start] < 16) continue
    if (components.length >= MAX_SPLIT_COMPONENTS) return null
    let read = 0
    let write = 0
    queue[write++] = start
    visited[start] = 1
    const pixels: number[] = []
    const bounds: MaskBounds = { left: width, top: height, right: -1, bottom: -1 }
    while (read < write) {
      const index = queue[read++]
      const x = index % width
      const y = Math.floor(index / width)
      pixels.push(index)
      bounds.left = Math.min(bounds.left, x)
      bounds.top = Math.min(bounds.top, y)
      bounds.right = Math.max(bounds.right, x)
      bounds.bottom = Math.max(bounds.bottom, y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue
        const next = nextY * width + nextX
        if (visited[next] || input[next] < 16) continue
        visited[next] = 1
        queue[write++] = next
      }
    }
    components.push({ bounds, pixels })
  }
  return components
}

function boundsSpan(bounds: MaskBounds): number {
  return Math.max(bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1)
}

function componentsAreNear(a: MaskComponent, b: MaskComponent): boolean {
  const gapX = Math.max(0, Math.max(a.bounds.left, b.bounds.left) - Math.min(a.bounds.right, b.bounds.right) - 1)
  const gapY = Math.max(0, Math.max(a.bounds.top, b.bounds.top) - Math.min(a.bounds.bottom, b.bounds.bottom) - 1)
  const mergeDistance = Math.max(4, Math.round(Math.min(boundsSpan(a.bounds), boundsSpan(b.bounds)) * 0.5))
  return Math.hypot(gapX, gapY) <= mergeDistance
}

function mergeNearbyComponents(components: MaskComponent[]): MaskComponent[] {
  const groups = components.map((component) => ({ ...component, pixels: [...component.pixels] }))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let first = 0; first < groups.length; first++) {
      for (let second = first + 1; second < groups.length; second++) {
        if (!componentsAreNear(groups[first], groups[second])) continue
        const other = groups[second]
        groups[first].bounds = {
          left: Math.min(groups[first].bounds.left, other.bounds.left),
          top: Math.min(groups[first].bounds.top, other.bounds.top),
          right: Math.max(groups[first].bounds.right, other.bounds.right),
          bottom: Math.max(groups[first].bounds.bottom, other.bounds.bottom),
        }
        for (const pixel of other.pixels) groups[first].pixels.push(pixel)
        groups.splice(second, 1)
        merged = true
        break outer
      }
    }
  }
  return groups
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
  contextFactorOverride?: number,
): InpaintRegion {
  const bounds = selectedMaskBounds(mask, maskWidth, maskHeight)
  if (!bounds) throw new Error('请先选择要消除的区域')
  const left = Math.floor(bounds.left * sourceWidth / maskWidth)
  const top = Math.floor(bounds.top * sourceHeight / maskHeight)
  const right = Math.ceil((bounds.right + 1) * sourceWidth / maskWidth)
  const bottom = Math.ceil((bounds.bottom + 1) * sourceHeight / maskHeight)
  const width = right - left
  const height = bottom - top
  const span = Math.max(width, height)
  const aspect = span / Math.max(1, Math.min(width, height))
  const contextFactor = contextFactorOverride ?? (aspect >= 4 ? 1.75 : aspect >= 2 ? 2.25 : 3)
  const size = Math.min(Math.max(sourceWidth, sourceHeight), Math.max(INPAINT_MODEL_SIZE, Math.ceil(span * contextFactor)))
  return {
    x: placeRegionAxis((left + right) / 2, size, sourceWidth),
    y: placeRegionAxis((top + bottom) / 2, size, sourceHeight),
    size,
  }
}

function refinementGrid(bounds: MaskBounds): { columns: number; rows: number } {
  const width = bounds.right - bounds.left + 1
  const height = bounds.bottom - bounds.top + 1
  if (width >= height * 1.8) return { columns: 4, rows: 1 }
  if (height >= width * 1.8) return { columns: 1, rows: 4 }
  return { columns: 2, rows: 2 }
}

export function createInpaintRefinementJobs(
  jobs: InpaintMaskJob[],
  maskWidth: number,
  maskHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): InpaintMaskJob[] {
  const output: InpaintMaskJob[] = []
  const candidates = jobs
    .filter((job) => job.region.size > REFINEMENT_REGION_THRESHOLD)
    .sort((a, b) => b.region.size - a.region.size)
  for (const job of candidates) {
    const bounds = selectedMaskBounds(job.mask, maskWidth, maskHeight)
    if (!bounds) continue
    const { columns, rows } = refinementGrid(bounds)
    const tileCount = columns * rows
    if (output.length + tileCount > MAX_REFINEMENT_JOBS) continue
    const tiles = Array.from({ length: tileCount }, () => new Uint8Array(job.mask.length))
    const boundsWidth = bounds.right - bounds.left + 1
    const boundsHeight = bounds.bottom - bounds.top + 1
    for (let y = bounds.top; y <= bounds.bottom; y++) for (let x = bounds.left; x <= bounds.right; x++) {
      const index = y * maskWidth + x
      if (job.mask[index] < 16) continue
      const column = Math.min(columns - 1, Math.floor((x - bounds.left) * columns / boundsWidth))
      const row = Math.min(rows - 1, Math.floor((y - bounds.top) * rows / boundsHeight))
      tiles[row * columns + column][index] = job.mask[index]
    }
    for (const tile of tiles) {
      if (!tile.some(Boolean)) continue
      output.push({
        mask: tile,
        region: createInpaintRegion(tile, maskWidth, maskHeight, sourceWidth, sourceHeight, REFINEMENT_CONTEXT_FACTOR),
      })
    }
  }
  return output
}

export function createInpaintMaskJobs(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): InpaintMaskJob[] {
  const components = connectedMaskComponents(mask, maskWidth, maskHeight)
  if (!components || components.length <= 1) {
    return [{ mask: mask.slice(), region: createInpaintRegion(mask, maskWidth, maskHeight, sourceWidth, sourceHeight) }]
  }
  return mergeNearbyComponents(components).map((component) => {
    const componentMask = new Uint8Array(mask.length)
    for (const pixel of component.pixels) componentMask[pixel] = mask[pixel]
    return {
      mask: componentMask,
      region: createInpaintRegion(componentMask, maskWidth, maskHeight, sourceWidth, sourceHeight),
    }
  }).sort((a, b) => a.region.size - b.region.size)
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

function cubicWeight(distance: number): number {
  const value = Math.abs(distance)
  if (value <= 1) return 1.5 * value ** 3 - 2.5 * value ** 2 + 1
  if (value < 2) return -0.5 * value ** 3 + 2.5 * value ** 2 - 4 * value + 2
  return 0
}

function bicubicSample(input: Uint8Array, width: number, height: number, x: number, y: number, channels: number, channel = 0): number {
  const baseX = Math.floor(x)
  const baseY = Math.floor(y)
  let value = 0
  let weight = 0
  for (let offsetY = -1; offsetY <= 2; offsetY++) {
    const sampleY = Math.max(0, Math.min(height - 1, baseY + offsetY))
    const weightY = cubicWeight(y - (baseY + offsetY))
    for (let offsetX = -1; offsetX <= 2; offsetX++) {
      const sampleX = Math.max(0, Math.min(width - 1, baseX + offsetX))
      const sampleWeight = weightY * cubicWeight(x - (baseX + offsetX))
      value += input[(sampleY * width + sampleX) * channels + channel] * sampleWeight
      weight += sampleWeight
    }
  }
  return Math.max(0, Math.min(255, value / Math.max(Number.EPSILON, weight)))
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
        rgb[pixel * 3 + channel] = Math.round(bicubicSample(source, sourceWidth, sourceHeight, sourceX, sourceY, 3, channel))
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
        const replacement = bicubicSample(generated, INPAINT_MODEL_SIZE, INPAINT_MODEL_SIZE, modelX, modelY, 3, channel)
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
