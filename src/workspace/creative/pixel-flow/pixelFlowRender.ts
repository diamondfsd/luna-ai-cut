export interface PixelFlowMask {
  data: Uint8Array
  width: number
  height: number
}

function maskValue(mask: PixelFlowMask, x: number, y: number, width: number, height: number): number {
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
