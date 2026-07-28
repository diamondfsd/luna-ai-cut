export interface PixelFlowMask {
  data: Uint8Array
  width: number
  height: number
}

export interface PixelFlowRegionScales {
  sky: number
  background: number
  subject: number
}

function maskValue(mask: PixelFlowMask | null, x: number, y: number, width: number, height: number): number {
  if (!mask) return 0
  const maskX = Math.min(mask.width - 1, Math.max(0, Math.floor((x / width) * mask.width)))
  const maskY = Math.min(mask.height - 1, Math.max(0, Math.floor((y / height) * mask.height)))
  return mask.data[maskY * mask.width + maskX] / 255
}

export function combinePixelFlowDepthMask(subjectMask: PixelFlowMask, skyMask: PixelFlowMask): PixelFlowMask {
  const width = subjectMask.width
  const height = subjectMask.height
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const subject = maskValue(subjectMask, x, y, width, height)
      const sky = maskValue(skyMask, x, y, width, height)
      data[y * width + x] = subject >= 0.35 ? 224 : sky >= 0.35 ? 32 : 128
    }
  }
  return { data, width, height }
}

export function pixelFlowRegionScales(subjectMask: PixelFlowMask, skyMask: PixelFlowMask): PixelFlowRegionScales {
  const width = subjectMask.width
  const height = subjectMask.height
  const bounds = Array.from({ length: 3 }, () => ({ minX: width, minY: height, maxX: -1, maxY: -1 }))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const subject = maskValue(subjectMask, x, y, width, height) >= 0.35
      const sky = !subject && maskValue(skyMask, x, y, width, height) >= 0.35
      const region = bounds[subject ? 2 : sky ? 0 : 1]
      region.minX = Math.min(region.minX, x)
      region.minY = Math.min(region.minY, y)
      region.maxX = Math.max(region.maxX, x)
      region.maxY = Math.max(region.maxY, y)
    }
  }
  const longestSide = Math.max(1, width, height)
  const scale = (region: (typeof bounds)[number]) => region.maxX < 0
    ? 1
    : Math.max(region.maxX - region.minX + 1, region.maxY - region.minY + 1) / longestSide
  return { sky: scale(bounds[0]), background: scale(bounds[1]), subject: scale(bounds[2]) }
}

export function pixelFlowSkyBlackRatio(pixels: Uint8ClampedArray, skyMask: PixelFlowMask): number {
  if (pixels.length < skyMask.width * skyMask.height * 4) return 0
  let skyPixels = 0
  let blackPixels = 0
  for (let index = 0; index < skyMask.data.length; index += 1) {
    if (skyMask.data[index] < 89) continue
    skyPixels += 1
    const pixelOffset = index * 4
    if (Math.max(pixels[pixelOffset], pixels[pixelOffset + 1], pixels[pixelOffset + 2]) <= 42) {
      blackPixels += 1
    }
  }
  return skyPixels > 0 ? blackPixels / skyPixels : 0
}

export function pixelFlowOrigin(mask: PixelFlowMask | null): { x: number; y: number } {
  if (!mask) return { x: 0.5, y: 0.28 }
  let weight = 0
  let weightedX = 0
  let weightedY = 0
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const value = mask.data[y * mask.width + x] / 255
      if (value < 0.35) continue
      weight += value
      weightedX += (x + 0.5) / mask.width * value
      weightedY += (y + 0.5) / mask.height * value
    }
  }
  if (weight < Math.max(8, mask.width * mask.height * 0.002)) return { x: 0.5, y: 0.28 }
  return { x: weightedX / weight, y: weightedY / weight }
}

export function pixelFlowImpact(mask: PixelFlowMask | null, origin = pixelFlowOrigin(mask)): { x: number; y: number } {
  if (!mask) return { x: origin.x, y: Math.min(0.82, origin.y + 0.2) }
  const rowWeights = new Float64Array(mask.height)
  let totalWeight = 0
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const value = mask.data[y * mask.width + x] / 255
      if (value < 0.35) continue
      rowWeights[y] += value
      totalWeight += value
    }
  }
  let accumulated = 0
  let skyBottom = origin.y
  for (let y = 0; y < rowWeights.length; y += 1) {
    accumulated += rowWeights[y]
    if (accumulated >= totalWeight * 0.96) {
      skyBottom = (y + 1) / mask.height
      break
    }
  }
  const impactY = Math.max(origin.y + 0.12, skyBottom + 0.035)
  return { x: origin.x, y: Math.max(0.18, Math.min(0.82, impactY)) }
}
