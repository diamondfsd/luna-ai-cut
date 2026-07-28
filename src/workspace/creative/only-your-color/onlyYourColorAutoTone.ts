export interface OnlyYourColorAutoTone {
  backgroundExposure: number
  backgroundBrightness: number
  backgroundContrast: number
}

export const NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE: OnlyYourColorAutoTone = {
  backgroundExposure: 0,
  backgroundBrightness: 0,
  backgroundContrast: 0,
}

const MAX_ANALYSIS_EDGE = 512
const MAX_BACKGROUND_EXPOSURE = 1.25
const TARGET_BACKGROUND_MEDIAN = 0.28
const MIN_BACKGROUND_SAMPLES = 64

function quantile(sorted: number[], position: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * position)))]
}

export function calculateOnlyYourColorAutoTone(options: {
  pixels: Uint8Array | Uint8ClampedArray
  imageWidth: number
  imageHeight: number
  mask: Uint8Array
  maskWidth: number
  maskHeight: number
}): OnlyYourColorAutoTone {
  const { pixels, imageWidth, imageHeight, mask, maskWidth, maskHeight } = options
  if (
    imageWidth <= 0 || imageHeight <= 0 || maskWidth <= 0 || maskHeight <= 0
    || pixels.length < imageWidth * imageHeight * 4 || mask.length < maskWidth * maskHeight
  ) return NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE

  const backgroundLuminance: number[] = []
  for (let y = 0; y < imageHeight; y += 1) {
    const maskY = Math.min(maskHeight - 1, Math.floor((y + 0.5) * maskHeight / imageHeight))
    for (let x = 0; x < imageWidth; x += 1) {
      const maskX = Math.min(maskWidth - 1, Math.floor((x + 0.5) * maskWidth / imageWidth))
      if (mask[maskY * maskWidth + maskX] >= 128) continue
      const offset = (y * imageWidth + x) * 4
      if (pixels[offset + 3] < 128) continue
      backgroundLuminance.push((
        pixels[offset] * 0.2126
        + pixels[offset + 1] * 0.7152
        + pixels[offset + 2] * 0.0722
      ) / 255)
    }
  }
  if (backgroundLuminance.length < MIN_BACKGROUND_SAMPLES) return NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE

  backgroundLuminance.sort((left, right) => left - right)
  const median = quantile(backgroundLuminance, 0.5)
  if (median >= TARGET_BACKGROUND_MEDIAN) return NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE

  const exposure = Math.min(MAX_BACKGROUND_EXPOSURE, Math.max(0, Math.log2(TARGET_BACKGROUND_MEDIAN / Math.max(0.04, median))))
  return {
    backgroundExposure: Math.round(exposure * 100) / 100,
    backgroundBrightness: 0,
    backgroundContrast: 0,
  }
}

export async function calculateOnlyYourColorAutoToneForFile(options: {
  filePath: string
  mask: Uint8Array
  maskWidth: number
  maskHeight: number
}): Promise<OnlyYourColorAutoTone> {
  try {
    const preview = await window.luna.workspace.loadPreview(options.filePath)
    const bitmap = await createImageBitmap(new Blob([preview.buffer], { type: preview.mimeType }))
    try {
      const scale = Math.min(1, MAX_ANALYSIS_EDGE / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE
      context.drawImage(bitmap, 0, 0, width, height)
      return calculateOnlyYourColorAutoTone({
        pixels: context.getImageData(0, 0, width, height).data,
        imageWidth: width,
        imageHeight: height,
        mask: options.mask,
        maskWidth: options.maskWidth,
        maskHeight: options.maskHeight,
      })
    } finally {
      bitmap.close()
    }
  } catch {
    return NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE
  }
}
