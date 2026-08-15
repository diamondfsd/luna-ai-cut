export interface LayerPositioningData {
  anchor: string
  targetWidth: number
  marginX: number
  marginY: number
}

export interface RenderColorAdjustments {
  exposure: number
  black: number
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  clarity: number
  texture: number
  sharpen: number
  denoise: number
  skinSmoothing: number
  glowStrength: number
  glowRadius: number
  glowThreshold: number
  gradeShadowsHue: number
  gradeShadowsAmount: number
  gradeMidHue: number
  gradeMidAmount: number
  gradeHighlightsHue: number
  gradeHighlightsAmount: number
  curveLift: number
  curveContrast: number
  curve: {
    rgb: Array<{ x: number; y: number }>
    luminance: Array<{ x: number; y: number }>
    red: Array<{ x: number; y: number }>
    green: Array<{ x: number; y: number }>
    blue: Array<{ x: number; y: number }>
  }
  levelsBlack: number
  levelsGray: number
  levelsWhite: number
  hslChannels: Array<{
    hue: number
    hueShift: number
    saturation: number
    luminance: number
  }>
}

export interface RenderCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface RenderLayerTransform {
  crop?: RenderCropRect
  orientation: number
  rotate: number
  flipH: boolean
  flipV: boolean
  scale: number
  translateX?: number
  translateY?: number
}

export function normalizeColor(color?: Partial<RenderColorAdjustments>): RenderColorAdjustments {
  const curve = color?.curve
  return {
    exposure: color?.exposure ?? 0,
    black: color?.black ?? 0,
    brightness: color?.brightness ?? 0,
    contrast: color?.contrast ?? 0,
    saturation: color?.saturation ?? 0,
    vibrance: color?.vibrance ?? 0,
    temperature: color?.temperature ?? 0,
    tint: color?.tint ?? 0,
    highlights: color?.highlights ?? 0,
    shadows: color?.shadows ?? 0,
    whites: color?.whites ?? 0,
    blacks: color?.blacks ?? 0,
    clarity: color?.clarity ?? 0,
    texture: color?.texture ?? 0,
    sharpen: color?.sharpen ?? 0,
    denoise: color?.denoise ?? 0,
    skinSmoothing: color?.skinSmoothing ?? 0,
    glowStrength: color?.glowStrength ?? 0,
    glowRadius: color?.glowRadius ?? 35,
    glowThreshold: color?.glowThreshold ?? 65,
    gradeShadowsHue: color?.gradeShadowsHue ?? 220,
    gradeShadowsAmount: color?.gradeShadowsAmount ?? 0,
    gradeMidHue: color?.gradeMidHue ?? 35,
    gradeMidAmount: color?.gradeMidAmount ?? 0,
    gradeHighlightsHue: color?.gradeHighlightsHue ?? 42,
    gradeHighlightsAmount: color?.gradeHighlightsAmount ?? 0,
    curveLift: color?.curveLift ?? 0,
    curveContrast: color?.curveContrast ?? 0,
    curve: {
      rgb: normalizeCurvePoints(curve?.rgb),
      luminance: normalizeCurvePoints(curve?.luminance),
      red: normalizeCurvePoints(curve?.red),
      green: normalizeCurvePoints(curve?.green),
      blue: normalizeCurvePoints(curve?.blue),
    },
    levelsBlack: color?.levelsBlack ?? 0,
    levelsGray: color?.levelsGray ?? 0.5,
    levelsWhite: color?.levelsWhite ?? 1,
    hslChannels: normalizeHslChannels(color?.hslChannels),
  }
}

const REQUIRED_COLOR_NUMBER_FIELDS = [
  'exposure', 'black', 'brightness', 'contrast', 'saturation', 'vibrance',
  'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks',
  'clarity', 'texture', 'sharpen', 'denoise', 'skinSmoothing',
  'glowStrength', 'glowRadius', 'glowThreshold',
  'gradeShadowsHue', 'gradeShadowsAmount', 'gradeMidHue', 'gradeMidAmount',
  'gradeHighlightsHue', 'gradeHighlightsAmount', 'curveLift', 'curveContrast',
  'levelsBlack', 'levelsGray', 'levelsWhite',
] as const satisfies ReadonlyArray<keyof RenderColorAdjustments>

export function normalizeColorForNative(color: Partial<RenderColorAdjustments>): {
  color: RenderColorAdjustments
  reset: boolean
} {
  const curve = color.curve
  const compatible = REQUIRED_COLOR_NUMBER_FIELDS.every((key) => Number.isFinite(color[key]))
    && curve !== undefined
    && ['rgb', 'luminance', 'red', 'green', 'blue'].every((key) => Array.isArray(curve[key as keyof typeof curve]))
    && Array.isArray(color.hslChannels)
  return compatible
    ? { color: normalizeColor(color), reset: false }
    : { color: normalizeColor(), reset: true }
}

export function cleanNativeInputValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cleanNativeInputValue(item)) as T
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item == null) continue
    if (key === 'color' && typeof item === 'object' && !Array.isArray(item)) {
      output[key] = cleanNativeInputValue(normalizeColorForNative(item as Partial<RenderColorAdjustments>).color)
      continue
    }
    output[key] = cleanNativeInputValue(item)
  }
  return output as T
}

const DEFAULT_HSL_CHANNELS = [0, 30, 60, 120, 180, 240, 285, 320]

function normalizeHslChannels(channels?: Array<{ hue?: number; hueShift?: number; saturation?: number; luminance?: number }>): RenderColorAdjustments['hslChannels'] {
  const count = Math.min(12, Math.max(DEFAULT_HSL_CHANNELS.length, channels?.length ?? 0))
  return Array.from({ length: count }, (_, index) => {
    const defaultHue = DEFAULT_HSL_CHANNELS[index] ?? 0
    const channel = Array.isArray(channels) ? channels[index] : undefined
    return {
      hue: clampNumber(channel?.hue ?? defaultHue, 0, 360),
      hueShift: clampNumber(channel?.hueShift ?? 0, -180, 180),
      saturation: clampNumber(channel?.saturation ?? 0, -100, 100),
      luminance: clampNumber(channel?.luminance ?? 0, -100, 100),
    }
  })
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min <= 0 && max >= 0 ? 0 : min
  return Math.min(max, Math.max(min, value))
}

function normalizeCurvePoints(points?: Array<{ x?: number; y?: number }>): Array<{ x: number; y: number }> {
  if (!Array.isArray(points)) return []
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: clamp01(point.x ?? 0),
      y: clamp01(point.y ?? 0),
    }))
    .sort((a, b) => a.x - b.x)
    .slice(0, 12)
}

function normalizeDegrees(value: number): number {
  const rounded = Math.round(value / 90) * 90
  return ((rounded % 360) + 360) % 360
}

function normalizeCrop(crop?: Partial<RenderCropRect> | null): RenderCropRect | undefined {
  if (!crop) return undefined
  const x = clamp01(crop.x ?? 0)
  const y = clamp01(crop.y ?? 0)
  const w = Math.max(0.001, Math.min(1 - x, crop.w ?? 1))
  const h = Math.max(0.001, Math.min(1 - y, crop.h ?? 1))
  return { x, y, w, h }
}

export function normalizeTransform(transform?: Partial<RenderLayerTransform>): RenderLayerTransform {
  const crop = normalizeCrop(transform?.crop)
  return {
    ...(crop ? { crop } : {}),
    orientation: normalizeDegrees(transform?.orientation ?? 0),
    rotate: transform?.rotate ?? 0,
    flipH: Boolean(transform?.flipH),
    flipV: Boolean(transform?.flipV),
    scale: Math.max(0.01, transform?.scale ?? 1),
    translateX: transform?.translateX ?? 0,
    translateY: transform?.translateY ?? 0,
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
