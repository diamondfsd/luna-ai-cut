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

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function saturatedFlowColors(red: number, green: number, blue: number): Pick<PixelFlowCell, 'color' | 'glowColor' | 'highlightColor'> {
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const center = (maximum + minimum) / 2
  const saturate = (channel: number) => clampChannel(center + (channel - center) * 1.24)
  const saturated = [saturate(red), saturate(green), saturate(blue)]
  const highlight = saturated.map((channel) => clampChannel(channel + (255 - channel) * 0.2))
  return {
    color: `rgb(${saturated[0]}, ${saturated[1]}, ${saturated[2]})`,
    glowColor: `rgba(${saturated[0]}, ${saturated[1]}, ${saturated[2]}, 0.9)`,
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
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const centerX = Math.min(width - 1, x + Math.floor(cellSize / 2))
      const centerY = Math.min(height - 1, y + Math.floor(cellSize / 2))
      const offset = (centerY * width + centerX) * 4
      const subject = maskValue(subjectMask, centerX, centerY, width, height)
      const sky = maskValue(skyMask, centerX, centerY, width, height)
      const textureVariation = (hashNoise(x / cellSize, y / cellSize) - 0.5) * 0.018
      const speedDifference = Math.max(0, Math.min(0.35, semanticDelay))
      // Sky leads, the subject follows, and the remaining image keeps the base speed.
      const semanticSpeed = 1 + speedDifference * (sky * 1.8 + (1 - sky) * subject * 0.9)
      const colors = saturatedFlowColors(pixels[offset], pixels[offset + 1], pixels[offset + 2])
      cells.push({
        x,
        y,
        width: Math.min(cellSize, width - x),
        height: Math.min(cellSize, height - y),
        arrival: centerY / height / semanticSpeed + textureVariation,
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
