import type { PreviewLayer } from '../../../shared/types'
import type { PixelStretchPresetId } from '../../../shared/types/workspace'

export interface SubjectBounds {
  x: number
  y: number
  w: number
  h: number
}

interface PixelStretchLayerOptions {
  layers: PreviewLayer[]
  maskPath: string
  preset: PixelStretchPresetId
  intensity: number
  angle: number
  samplePosition: number
  ribbonSize: number
  subjectBounds: SubjectBounds
}

const RENDER_MODE_BY_PRESET = {
  left: 'left',
  right: 'right',
  top: 'up',
  bottom: 'down',
  horizontal: 'horizontal',
  vertical: 'vertical',
} as const

export function subjectBoundsFromMask(
  data: Uint8Array,
  width: number,
  height: number,
): SubjectBounds | null {
  if (data.length !== width * height || width <= 0 || height <= 0) return null
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[y * width + x] < 24) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  return {
    x: minX / width,
    y: minY / height,
    w: (maxX - minX + 1) / width,
    h: (maxY - minY + 1) / height,
  }
}

export function erodeMaskOnePixel(data: Uint8Array, width: number, height: number): Uint8Array {
  if (data.length !== width * height || width <= 0 || height <= 0) return new Uint8Array()
  const output = new Uint8Array(data.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let minimum = 255
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sampleX = x + offsetX
          const sampleY = y + offsetY
          if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
            minimum = 0
          } else {
            minimum = Math.min(minimum, data[sampleY * width + sampleX])
          }
        }
      }
      output[y * width + x] = minimum
    }
  }
  return output
}

/** 图层顺序：原图背景 -> 中心 1px 延展的纸带 -> 清晰主体。 */
export function buildPixelStretchLayers(options: PixelStretchLayerOptions): PreviewLayer[] {
  const main = options.layers[0]
  if (!main) return []
  const bounds = options.subjectBounds
  const horizontal = options.preset === 'left' || options.preset === 'right' || options.preset === 'horizontal'
  const sample = Math.max(0, Math.min(1, options.samplePosition / 100))
  const background: PreviewLayer = { ...main, zIndex: 0 }
  const stretch: PreviewLayer = {
    ...main,
    layerType: 'pixel-stretch',
    maskPath: options.maskPath,
    maskOpacity: 1,
    maskInverted: false,
    maskFeather: 0,
    pixelStretch: {
      mode: RENDER_MODE_BY_PRESET[options.preset],
      intensity: options.intensity,
      originX: horizontal ? bounds.x + bounds.w * sample : bounds.x + bounds.w / 2,
      originY: horizontal ? bounds.y + bounds.h / 2 : bounds.y + bounds.h * sample,
      angle: options.angle,
      ribbonSize: options.ribbonSize,
    },
    zIndex: 1,
  }
  const subject: PreviewLayer = {
    ...main,
    layerType: 'local-color',
    fit: 'cover',
    maskPath: options.maskPath,
    maskOpacity: 1,
    maskInverted: false,
    maskFeather: 1,
    zIndex: 2,
  }
  const decorations = options.layers.slice(1).map((layer, index) => ({
    ...layer,
    zIndex: Math.max(20 + index, layer.zIndex),
  }))
  return [background, stretch, subject, ...decorations]
}
