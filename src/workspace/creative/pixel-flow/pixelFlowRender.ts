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

export function createPixelFlowCells(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cellSize: number,
  semanticDelay: number,
  mask: PixelFlowMask | null,
): PixelFlowCell[] {
  const cells: PixelFlowCell[] = []
  for (let y = 0; y < height; y += cellSize) {
    for (let x = 0; x < width; x += cellSize) {
      const centerX = Math.min(width - 1, x + Math.floor(cellSize / 2))
      const centerY = Math.min(height - 1, y + Math.floor(cellSize / 2))
      const offset = (centerY * width + centerX) * 4
      const subject = maskValue(mask, centerX, centerY, width, height)
      const textureVariation = (hashNoise(x / cellSize, y / cellSize) - 0.5) * 0.018
      const contentDelay = subject * semanticDelay
      cells.push({
        x,
        y,
        width: Math.min(cellSize, width - x),
        height: Math.min(cellSize, height - y),
        arrival: centerY / height + contentDelay + textureVariation,
        color: `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`,
      })
    }
  }
  return cells
}

export function pixelFlowProgress(elapsed: number, duration: number): number {
  const linear = Math.max(0, Math.min(1, elapsed / Math.max(0.1, duration)))
  return linear * linear
}
