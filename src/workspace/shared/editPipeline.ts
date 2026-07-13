import type { WatermarkSettings } from '../../shared/types'
import { EDIT_PARAMETER_RANGES, clampNumber } from './editParameterRanges'

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export type WhiteBalanceMode = 'custom' | 'daylight' | 'cloudy' | 'indoor'
export type ToneCurveChannel = 'rgb' | 'luminance' | 'red' | 'green' | 'blue'
export type HslChannelKey = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'magenta'

export interface CurvePoint {
  x: number
  y: number
}

export interface ToneCurveAdjust {
  activeChannel: ToneCurveChannel
  points: Record<ToneCurveChannel, CurvePoint[]>
}

export interface HslChannelAdjust {
  hue: number
  hueShift: number
  saturation: number
  luminance: number
}

export interface VideoTrimState {
  /** Trim start time in seconds */
  startTime: number
  /** Trim end time in seconds */
  endTime: number
}

export interface BorderSettings {
  enabled: boolean
  presetId: string
  /** 预设中所有层的纵向尺寸，百分比 */
  frameSize: number
  backgroundColor: string
  textColor: string
  opacity: number
  showLogo: boolean
  showTitle: boolean
  showCameraInfo: boolean
  showDate: boolean
  title: string
  /** 在裁剪结果之上应用的主素材缩放和位置，所有边框预设共用。 */
  mediaScale: number
  mediaOffsetX: number
  mediaOffsetY: number
}

export interface EditPipeline {
  /** 视频截取：非破坏性时间范围裁剪。图片素材忽略此字段。 */
  trim: VideoTrimState | null
  transform: {
    crop: CropRect | null
    orientation: number
    rotate: number
    flipH: boolean
    flipV: boolean
    scale: number
  }
  color: {
    // Exposure
    exposure: number
    brightness: number

    // White Balance
    whiteBalanceMode: WhiteBalanceMode
    temperature: number
    tint: number

    // Tone Equalizer
    shadows: number
    highlights: number
    whites: number
    blacks: number

    // Color Balance
    contrast: number
    vibrance: number
    saturation: number

    // Color Grading (three-way)
    gradeShadowsHue: number
    gradeShadowsAmount: number
    gradeMidHue: number
    gradeMidAmount: number
    gradeHighlightsHue: number
    gradeHighlightsAmount: number

    // Curves
    curve: ToneCurveAdjust
    curveLift: number
    curveContrast: number

    // Levels
    levelsBlack: number
    levelsGray: number
    levelsWhite: number

    // HSL (multi-band)
    hslChannels: Record<HslChannelKey, HslChannelAdjust>

    // Detail
    clarity: number
    texture: number
    sharpen: number
    denoise: number
  }
  effects: {
    sharpen: number
    denoise: number
  }
  lutFilter: {
    activeId: string | null
    /** 滤镜强度 1-100，默认 100 */
    intensity: number
  }
  watermark: WatermarkSettings
  border: BorderSettings
}

export type PipelinePatch = {
  trim?: VideoTrimState | null
  transform?: Partial<EditPipeline['transform']>
  color?: Partial<EditPipeline['color']>
  effects?: Partial<EditPipeline['effects']>
  lutFilter?: Partial<EditPipeline['lutFilter']>
  watermark?: Partial<EditPipeline['watermark']>
  border?: Partial<EditPipeline['border']>
}

export const TONE_CURVE_CHANNELS: ToneCurveChannel[] = ['rgb', 'luminance', 'red', 'green', 'blue']
export const HSL_CHANNELS: Array<{ key: HslChannelKey; label: string; hue: number; color: string }> = [
  { key: 'red', label: '红色', hue: 0, color: '#ff453a' },
  { key: 'orange', label: '橙色', hue: 30, color: '#ff9f0a' },
  { key: 'yellow', label: '黄色', hue: 60, color: '#ffd60a' },
  { key: 'green', label: '绿色', hue: 120, color: '#30d158' },
  { key: 'cyan', label: '青色', hue: 180, color: '#64d2ff' },
  { key: 'blue', label: '蓝色', hue: 240, color: '#0a84ff' },
  { key: 'purple', label: '紫色', hue: 285, color: '#bf5af2' },
  { key: 'magenta', label: '洋红', hue: 320, color: '#ff2d9a' },
]

export function createDefaultCurve(): ToneCurveAdjust {
  return {
    activeChannel: 'rgb',
    points: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [channel, [] as CurvePoint[]])) as Record<ToneCurveChannel, CurvePoint[]>,
  }
}

export function createDefaultHslChannels(): Record<HslChannelKey, HslChannelAdjust> {
  return Object.fromEntries(HSL_CHANNELS.map((channel) => [
    channel.key,
    { hue: channel.hue, hueShift: 0, saturation: 0, luminance: 0 },
  ])) as Record<HslChannelKey, HslChannelAdjust>
}

export const DEFAULT_PIPELINE: EditPipeline = {
  trim: null,
  transform: {
    crop: null,
    orientation: 0,
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1,
  },
  color: {
    whiteBalanceMode: 'custom',
    exposure: 0,
    brightness: 0,
    temperature: 0,
    tint: 0,
    contrast: 0,
    saturation: 0,
    vibrance: 0,
    shadows: 0,
    highlights: 0,
    whites: 0,
    blacks: 0,

    gradeShadowsHue: 220,
    gradeShadowsAmount: 0,
    gradeMidHue: 35,
    gradeMidAmount: 0,
    gradeHighlightsHue: 42,
    gradeHighlightsAmount: 0,

    curve: createDefaultCurve(),
    curveLift: 0,
    curveContrast: 0,

    levelsBlack: 0,
    levelsGray: 0.5,
    levelsWhite: 1,

    hslChannels: createDefaultHslChannels(),

    clarity: 0,
    texture: 0,
    sharpen: 0,
    denoise: 0,
  },
  effects: {
    sharpen: 0,
    denoise: 0,
  },
  lutFilter: {
    activeId: null,
    intensity: 30,
  },
  watermark: {
    enabled: true,
    style: 'luna_ultra_cn',
    position: 'bottom-center',
  },
  border: {
    enabled: false,
    presetId: 'classic-white',
    frameSize: 100,
    backgroundColor: '#F7F6F2',
    textColor: '#444444',
    opacity: 100,
    showLogo: true,
    showTitle: true,
    showCameraInfo: true,
    showDate: true,
    title: 'Insta360',
    mediaScale: 100,
    mediaOffsetX: 0,
    mediaOffsetY: 0,
  },
}

export function createDefaultPipeline(): EditPipeline {
  return structuredClone(DEFAULT_PIPELINE)
}

export const WHITE_BALANCE_DEFAULTS: Partial<EditPipeline['color']> = {
  whiteBalanceMode: 'custom',
  temperature: 0,
  tint: 0,
}

export const TONE_DEFAULTS: Partial<EditPipeline['color']> = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  clarity: 0,
  texture: 0,
  vibrance: 0,
  saturation: 0,
}

export const CURVE_DEFAULTS: Partial<EditPipeline['color']> = {
  curve: createDefaultCurve(),
  levelsBlack: 0,
  levelsGray: 0.5,
  levelsWhite: 1,
}

export const HSL_DEFAULTS: Partial<EditPipeline['color']> = {
  hslChannels: createDefaultHslChannels(),
}

export const GRADING_DEFAULTS: Partial<EditPipeline['color']> = {
  gradeShadowsHue: 220,
  gradeShadowsAmount: 0,
  gradeMidHue: 35,
  gradeMidAmount: 0,
  gradeHighlightsHue: 42,
  gradeHighlightsAmount: 0,
}

export const DETAIL_DEFAULTS: Partial<EditPipeline['color']> = {
  sharpen: 0,
  denoise: 0,
}

export const EFFECT_DETAIL_DEFAULTS: Partial<EditPipeline['effects']> = {
  sharpen: 0,
  denoise: 0,
}

function mergeCurve(current: ToneCurveAdjust, patch?: Partial<ToneCurveAdjust> | null): ToneCurveAdjust {
  if (!patch) return current
  return {
    activeChannel: patch.activeChannel ?? current.activeChannel,
    points: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [
      channel,
      normalizeCurvePoints(patch.points?.[channel] ?? current.points[channel]),
    ])) as Record<ToneCurveChannel, CurvePoint[]>,
  }
}

function normalizeCurvePoints(points: CurvePoint[] | undefined): CurvePoint[] {
  if (!Array.isArray(points)) return []
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: clampNumber(point.x, EDIT_PARAMETER_RANGES.curve.point),
      y: clampNumber(point.y, EDIT_PARAMETER_RANGES.curve.point),
    }))
    .sort((a, b) => a.x - b.x)
    .slice(0, 12)
}

function normalizeCurve(curve: ToneCurveAdjust): ToneCurveAdjust {
  return {
    activeChannel: TONE_CURVE_CHANNELS.includes(curve.activeChannel) ? curve.activeChannel : 'rgb',
    points: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [
      channel,
      normalizeCurvePoints(curve.points[channel]),
    ])) as Record<ToneCurveChannel, CurvePoint[]>,
  }
}

function normalizeHslChannels(channels: Record<HslChannelKey, HslChannelAdjust>): Record<HslChannelKey, HslChannelAdjust> {
  const hslRanges = EDIT_PARAMETER_RANGES.hsl
  return Object.fromEntries(HSL_CHANNELS.map((channel) => {
    const current = channels[channel.key] ?? { hue: channel.hue, hueShift: 0, saturation: 0, luminance: 0 }
    return [channel.key, {
      hue: channel.hue,
      hueShift: clampNumber(current.hueShift, hslRanges.hue),
      saturation: clampNumber(current.saturation, hslRanges.saturation),
      luminance: clampNumber(current.luminance, hslRanges.luminance),
    }]
  })) as Record<HslChannelKey, HslChannelAdjust>
}

function normalizePipeline(pipeline: EditPipeline): EditPipeline {
  const color = EDIT_PARAMETER_RANGES.color
  const levels = EDIT_PARAMETER_RANGES.levels
  const effects = EDIT_PARAMETER_RANGES.effects

  // Normalize trim: ensure valid range, or null
  let trim: VideoTrimState | null = null
  if (pipeline.trim && Number.isFinite(pipeline.trim.startTime) && Number.isFinite(pipeline.trim.endTime)) {
    const start = Math.max(0, pipeline.trim.startTime)
    const end = Math.max(start + 0.1, pipeline.trim.endTime)
    trim = { startTime: start, endTime: end }
  }

  return {
    ...pipeline,
    trim,
    watermark: { ...DEFAULT_PIPELINE.watermark, ...(pipeline.watermark ?? {}) },
    border: normalizeBorder(pipeline.border),
    color: {
      ...pipeline.color,
      whiteBalanceMode: ['custom', 'daylight', 'cloudy', 'indoor'].includes(pipeline.color.whiteBalanceMode) ? pipeline.color.whiteBalanceMode : 'custom',
      exposure: clampNumber(pipeline.color.exposure, color.exposure),
      brightness: clampNumber(pipeline.color.brightness, color.brightness),
      temperature: clampNumber(pipeline.color.temperature, color.temperature),
      tint: clampNumber(pipeline.color.tint, color.tint),
      contrast: clampNumber(pipeline.color.contrast, color.contrast),
      saturation: clampNumber(pipeline.color.saturation, color.saturation),
      vibrance: clampNumber(pipeline.color.vibrance, color.vibrance),
      shadows: clampNumber(pipeline.color.shadows, color.shadows),
      highlights: clampNumber(pipeline.color.highlights, color.highlights),
      whites: clampNumber(pipeline.color.whites, color.whites),
      blacks: clampNumber(pipeline.color.blacks, color.blacks),

      gradeShadowsHue: clampNumber(pipeline.color.gradeShadowsHue, EDIT_PARAMETER_RANGES.grading.hue),
      gradeShadowsAmount: clampNumber(pipeline.color.gradeShadowsAmount, EDIT_PARAMETER_RANGES.grading.amount),
      gradeMidHue: clampNumber(pipeline.color.gradeMidHue, EDIT_PARAMETER_RANGES.grading.hue),
      gradeMidAmount: clampNumber(pipeline.color.gradeMidAmount, EDIT_PARAMETER_RANGES.grading.amount),
      gradeHighlightsHue: clampNumber(pipeline.color.gradeHighlightsHue, EDIT_PARAMETER_RANGES.grading.hue),
      gradeHighlightsAmount: clampNumber(pipeline.color.gradeHighlightsAmount, EDIT_PARAMETER_RANGES.grading.amount),

      curve: normalizeCurve(pipeline.color.curve),
      curveLift: clampNumber(pipeline.color.curveLift, color.curveLift),
      curveContrast: clampNumber(pipeline.color.curveContrast, color.curveContrast),

      levelsBlack: clampNumber(pipeline.color.levelsBlack, levels.black),
      levelsGray: clampNumber(pipeline.color.levelsGray, levels.gray),
      levelsWhite: clampNumber(pipeline.color.levelsWhite, levels.white),

      hslChannels: normalizeHslChannels(pipeline.color.hslChannels),

      clarity: clampNumber(pipeline.color.clarity, color.clarity),
      texture: clampNumber(pipeline.color.texture, color.texture),
      sharpen: clampNumber(pipeline.color.sharpen, color.sharpen),
      denoise: clampNumber(pipeline.color.denoise, color.denoise),
    },
    effects: {
      sharpen: clampNumber(pipeline.effects.sharpen, effects.sharpen),
      denoise: clampNumber(pipeline.effects.denoise, effects.denoise),
    },
  }
}

function normalizeBorder(input: Partial<BorderSettings> | undefined): BorderSettings {
  const value = input as (Partial<BorderSettings> & { bottomColor?: unknown }) | undefined
  const legacyColor = typeof value?.bottomColor === 'string' ? value.bottomColor : undefined
  return {
    ...DEFAULT_PIPELINE.border,
    ...value,
    presetId: typeof value?.presetId === 'string' ? value.presetId : DEFAULT_PIPELINE.border.presetId,
    frameSize: clampNumber(Number(value?.frameSize ?? 100), { min: 70, max: 135 }),
    backgroundColor: typeof value?.backgroundColor === 'string' ? value.backgroundColor : legacyColor ?? DEFAULT_PIPELINE.border.backgroundColor,
    textColor: typeof value?.textColor === 'string' ? value.textColor : DEFAULT_PIPELINE.border.textColor,
    opacity: clampNumber(Number(value?.opacity ?? 100), { min: 0, max: 100 }),
    mediaScale: clampNumber(Number(value?.mediaScale ?? 100), { min: 70, max: 160 }),
    mediaOffsetX: clampNumber(Number(value?.mediaOffsetX ?? 0), { min: -50, max: 50 }),
    mediaOffsetY: clampNumber(Number(value?.mediaOffsetY ?? 0), { min: -50, max: 50 }),
  }
}

export function mergePipeline(pipeline: EditPipeline, patch: PipelinePatch): EditPipeline {
  return normalizePipeline({
    trim: patch.trim !== undefined ? patch.trim : pipeline.trim,
    transform: { ...pipeline.transform, ...patch.transform },
    color: {
      ...pipeline.color,
      ...patch.color,
      curve: mergeCurve(pipeline.color.curve, patch.color?.curve),
    },
    effects: { ...pipeline.effects, ...patch.effects },
    lutFilter: { ...pipeline.lutFilter, ...patch.lutFilter },
    watermark: { ...pipeline.watermark, ...patch.watermark },
    border: { ...pipeline.border, ...patch.border },
  })
}

export function serializePipeline(pipeline: EditPipeline): string {
  return JSON.stringify(pipeline)
}

export function deserializePipeline(value: string): EditPipeline {
  const parsed = JSON.parse(value) as PipelinePatch
  return mergePipeline(createDefaultPipeline(), parsed)
}
