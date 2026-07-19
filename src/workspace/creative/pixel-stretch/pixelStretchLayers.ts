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
  angle: number
  samplePosition: number
  sampleEndPosition: number
  sampleRangeStart: number
  sampleRangeEnd: number
  sampleControlStartOffset: number
  sampleControlEndOffset: number
  maskInverted?: boolean
  maskFeather?: number
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
  const sampleEndPosition = Math.max(0, Math.min(1, options.sampleEndPosition / 100))
  const rangeStart = Math.max(0, Math.min(1, options.sampleRangeStart / 100))
  const rangeEnd = Math.max(0, Math.min(1, options.sampleRangeEnd / 100))
  const sampleStart = horizontal
    ? bounds.y + bounds.h * rangeStart
    : bounds.x + bounds.w * rangeStart
  const sampleEnd = horizontal
    ? bounds.y + bounds.h * rangeEnd
    : bounds.x + bounds.w * rangeEnd
  const controlStart = Math.max(0, Math.min(1, sample + (sampleEndPosition - sample) / 3 + options.sampleControlStartOffset / 100))
  const controlEnd = Math.max(0, Math.min(1, sample + (sampleEndPosition - sample) * 2 / 3 + options.sampleControlEndOffset / 100))
  const lineEnd = horizontal
    ? bounds.x + bounds.w * sampleEndPosition
    : bounds.y + bounds.h * sampleEndPosition
  const centerX = horizontal
    ? (bounds.x + bounds.w * sample + lineEnd) / 2
    : (sampleStart + sampleEnd) / 2
  const centerY = horizontal
    ? (sampleStart + sampleEnd) / 2
    : (bounds.y + bounds.h * sample + lineEnd) / 2
  const background: PreviewLayer = { ...main, zIndex: 0 }
  const stretch: PreviewLayer = {
    ...main,
    layerType: 'pixel-stretch',
    maskPath: options.maskPath,
    maskOpacity: 1,
    maskInverted: options.maskInverted ?? false,
    maskFeather: 0,
    pixelStretch: {
      mode: RENDER_MODE_BY_PRESET[options.preset],
      intensity: 100,
      originX: horizontal ? bounds.x + bounds.w * sample : bounds.x + bounds.w / 2,
      originY: horizontal ? bounds.y + bounds.h / 2 : bounds.y + bounds.h * sample,
      angle: options.angle,
      ribbonSize: Math.round(Math.abs(rangeEnd - rangeStart) * 100),
      sampleStart,
      sampleEnd,
      lineEnd,
      controlStart: horizontal
        ? bounds.x + bounds.w * controlStart
        : bounds.y + bounds.h * controlStart,
      controlEnd: horizontal
        ? bounds.x + bounds.w * controlEnd
        : bounds.y + bounds.h * controlEnd,
      centerX,
      centerY,
    },
    zIndex: 1,
  }
  const subject: PreviewLayer = {
    ...main,
    layerType: 'local-color',
    fit: 'cover',
    maskPath: options.maskPath,
    maskOpacity: 1,
    maskInverted: options.maskInverted ?? false,
    maskFeather: options.maskFeather ?? 1,
    zIndex: 2,
  }
  const decorations = options.layers.slice(1).map((layer, index) => ({
    ...layer,
    zIndex: Math.max(20 + index, layer.zIndex),
  }))
  return [background, stretch, subject, ...decorations]
}
