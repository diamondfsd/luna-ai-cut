import type { PreviewLayer } from '../../../shared/types'
import type { PixelStretchFlowShape, PixelStretchPathPoint, PixelStretchPresetId } from '../../../shared/types/workspace'
import { buildPixelStretchFlowPath, flattenPixelStretchPath } from './pixelStretchPath'

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
  sourceAspect?: number
  flowShape?: PixelStretchFlowShape
  flowLength?: number
  flowCurve?: number
  flowWidth?: number
  flowEndWidth?: number
  flowPoints?: PixelStretchPathPoint[]
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

export function invertMask(data: Uint8Array): Uint8Array {
  return data.map((value) => 255 - value)
}

/** 优先把色带伸向主体周围留白最多的方向。 */
export function suggestPixelStretchPreset(bounds: SubjectBounds, sourceAspect = 1): PixelStretchPresetId {
  const aspect = Math.max(0.0001, sourceAspect)
  const spaces: Array<[PixelStretchPresetId, number]> = [
    ['left', bounds.x * aspect],
    ['right', (1 - bounds.x - bounds.w) * aspect],
    ['top', bounds.y],
    ['bottom', 1 - bounds.y - bounds.h],
  ]
  return spaces.reduce((best, current) => current[1] > best[1] ? current : best)[0]
}

/** 图层顺序：原图背景 -> 中心 1px 延展的纸带 -> 清晰主体。 */
export function buildPixelStretchLayers(options: PixelStretchLayerOptions): PreviewLayer[] {
  const main = options.layers.find((layer) => layer.precomposeRole === 'output') ?? options.layers[0]
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
  const sourceAspect = Math.max(0.0001, options.sourceAspect ?? 1)
  const sampledWidth = Math.abs(sampleEnd - sampleStart) * (horizontal ? 1 : sourceAspect)
  const pathStartWidth = sampledWidth * (options.flowWidth ?? 100) / 100
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
  const flowPath = buildPixelStretchFlowPath({
    shape: options.flowShape ?? 'straight',
    preset: options.preset,
    length: options.flowLength ?? 70,
    curve: options.flowCurve ?? 60,
    aspect: sourceAspect,
    bounds,
    start: { x: centerX, y: centerY },
    startInset: pathStartWidth / 2,
    customPoints: options.flowPoints,
  })
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
      pathPoints: flattenPixelStretchPath(flowPath),
      pathStartWidth,
      pathEndWidth: sampledWidth * (options.flowEndWidth ?? 55) / 100,
      fillSampleGaps: true,
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
  const precomposeInputs = options.layers.filter((layer) => layer.precomposeRole === 'input')
  const decorations = options.layers.filter((layer) => (
    layer !== main && layer.precomposeRole !== 'input'
  )).map((layer, index) => ({
    ...layer,
    zIndex: Math.max(20 + index, layer.zIndex),
  }))
  return [...precomposeInputs, background, stretch, subject, ...decorations]
}
