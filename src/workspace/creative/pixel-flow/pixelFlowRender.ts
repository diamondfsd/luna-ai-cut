export interface PixelFlowMask {
  data: Uint8Array
  width: number
  height: number
}

export interface PixelFlowCell {
  x: number
  y: number
  width: number
  height: number
  arrival: number
  color: string
  glowColor: string
  highlightColor: string
}

function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return value - Math.floor(value)
}

function maskValue(mask: PixelFlowMask | null, x: number, y: number, width: number, height: number): number {
  if (!mask) return 0
  const maskX = Math.min(mask.width - 1, Math.max(0, Math.floor((x / width) * mask.width)))
  const maskY = Math.min(mask.height - 1, Math.max(0, Math.floor((y / height) * mask.height)))
  return mask.data[maskY * mask.width + maskX] / 255
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
  let skyBottom = 0
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.data[y * mask.width + x] >= 90) skyBottom = Math.max(skyBottom, (y + 0.5) / mask.height)
    }
  }
  const impactY = Math.max(origin.y + 0.12, skyBottom + 0.035)
  return { x: origin.x, y: Math.max(0.18, Math.min(0.82, impactY)) }
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function saturatedFlowColors(red: number, green: number, blue: number): Pick<PixelFlowCell, 'color' | 'glowColor' | 'highlightColor'> {
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const center = (maximum + minimum) / 2
  const saturate = (channel: number) => clampChannel(center + (channel - center) * 1.42)
  const saturated = [saturate(red), saturate(green), saturate(blue)]
  const highlight = saturated.map((channel) => clampChannel(channel + (255 - channel) * 0.36))
  return {
    color: `rgb(${saturated[0]}, ${saturated[1]}, ${saturated[2]})`,
    glowColor: `rgba(${saturated[0]}, ${saturated[1]}, ${saturated[2]}, 1)`,
    highlightColor: `rgb(${highlight[0]}, ${highlight[1]}, ${highlight[2]})`,
  }
}

export function createPixelFlowCells(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cellSize: number,
  semanticDelay: number,
  subjectMask: PixelFlowMask | null,
  skyMask: PixelFlowMask | null,
): PixelFlowCell[] {
  const cells: PixelFlowCell[] = []
  const origin = pixelFlowOrigin(skyMask)
  const impact = pixelFlowImpact(skyMask, origin)
  const originX = origin.x * width
  const originY = origin.y * height
  const impactX = impact.x * width
  const impactY = impact.y * height
  const maximumDistance = Math.max(
    Math.hypot(impactX, impactY),
    Math.hypot(width - impactX, impactY),
    Math.hypot(impactX, height - impactY),
    Math.hypot(width - impactX, height - impactY),
  )
  const descentWidth = Math.max(cellSize * 2.2, width * 0.028)
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const centerX = Math.min(width - 1, x + Math.floor(cellSize / 2))
      const centerY = Math.min(height - 1, y + Math.floor(cellSize / 2))
      const offset = (centerY * width + centerX) * 4
      const subject = maskValue(subjectMask, centerX, centerY, width, height)
      const sky = maskValue(skyMask, centerX, centerY, width, height)
      const deltaX = centerX - impactX
      const deltaY = centerY - impactY
      const radialDistance = Math.hypot(deltaX, deltaY) / Math.max(1, maximumDistance)
      const angle = Math.atan2(deltaY, deltaX)
      const textureVariation = (hashNoise(x / cellSize, y / cellSize) - 0.5) * 0.026
      const waveVariation = Math.sin(angle * 3.2 + radialDistance * 12) * 0.014
      const speedDifference = Math.max(0, Math.min(0.35, semanticDelay))
      // Sky leads, the subject follows, and the remaining image keeps the base speed.
      const semanticSpeed = 1 + speedDifference * (sky * 1.8 + (1 - sky) * subject * 0.9)
      const colors = saturatedFlowColors(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      const insideDescent = centerY >= originY
        && centerY <= impactY
        && Math.abs(centerX - originX) <= descentWidth
      const descentProgress = (centerY - originY) / Math.max(1, impactY - originY)
      const descentOffset = Math.abs(centerX - originX) / descentWidth * 0.035
      const arrival = insideDescent
        ? 0.025 + Math.max(0, Math.min(1, descentProgress)) * 0.25 + descentOffset + textureVariation * 0.3
        : 0.31 + radialDistance / semanticSpeed * 0.61 + textureVariation + waveVariation
      cells.push({
        x,
        y,
        width: Math.min(cellSize, width - x),
        height: Math.min(cellSize, height - y),
        arrival,
        ...colors,
      })
    }
  }
  return cells
}

export function pixelFlowProgress(elapsed: number, duration: number): number {
  const linear = Math.max(0, Math.min(1, elapsed / Math.max(0.1, duration)))
  // Constant acceleration produces a linearly increasing velocity.
  return linear * linear
}
