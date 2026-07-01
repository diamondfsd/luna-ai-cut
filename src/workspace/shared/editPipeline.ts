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

export interface CurvePoint {
  x: number
  y: number
}

export interface ToneCurveAdjust {
  activeChannel: ToneCurveChannel
  points: Record<ToneCurveChannel, CurvePoint[]>
}

export interface EditPipeline {
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
    black: number
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

    // HSL (single-band)
    hue: number
    hslHue: number
    hslSat: number
    hslLum: number

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
  watermark: WatermarkSettings
}

export type PipelinePatch = {
  transform?: Partial<EditPipeline['transform']>
  color?: Partial<EditPipeline['color']>
  effects?: Partial<EditPipeline['effects']>
  watermark?: Partial<EditPipeline['watermark']>
}

export const TONE_CURVE_CHANNELS: ToneCurveChannel[] = ['rgb', 'luminance', 'red', 'green', 'blue']

export function createDefaultCurve(): ToneCurveAdjust {
  return {
    activeChannel: 'rgb',
    points: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [channel, [] as CurvePoint[]])) as Record<ToneCurveChannel, CurvePoint[]>,
  }
}

export const DEFAULT_PIPELINE: EditPipeline = {
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
    black: 0,
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

    hue: 0,
    hslHue: 30,
    hslSat: 0,
    hslLum: 0,

    clarity: 0,
    texture: 0,
    sharpen: 0,
    denoise: 0,
  },
  effects: {
    sharpen: 0,
    denoise: 0,
  },
  watermark: {
    enabled: false,
    style: 'luna_ultra_cn',
    watermarkPercent: 20,
    position: 'bottom-center',
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
  black: 0,
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
  curveLift: 0,
  curveContrast: 0,
  levelsBlack: 0,
  levelsGray: 0.5,
  levelsWhite: 1,
}

export const HSL_DEFAULTS: Partial<EditPipeline['color']> = {
  hue: 0,
  hslHue: 30,
  hslSat: 0,
  hslLum: 0,
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

function normalizePipeline(pipeline: EditPipeline): EditPipeline {
  const color = EDIT_PARAMETER_RANGES.color
  const levels = EDIT_PARAMETER_RANGES.levels
  const effects = EDIT_PARAMETER_RANGES.effects

  return {
    ...pipeline,
    color: {
      ...pipeline.color,
      whiteBalanceMode: ['custom', 'daylight', 'cloudy', 'indoor'].includes(pipeline.color.whiteBalanceMode) ? pipeline.color.whiteBalanceMode : 'custom',
      exposure: clampNumber(pipeline.color.exposure, color.exposure),
      black: clampNumber(pipeline.color.black, color.black),
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

      hue: clampNumber(pipeline.color.hue, EDIT_PARAMETER_RANGES.hsl.hue),
      hslHue: clampNumber(pipeline.color.hslHue, EDIT_PARAMETER_RANGES.hsl.hslHue),
      hslSat: clampNumber(pipeline.color.hslSat, EDIT_PARAMETER_RANGES.hsl.saturation),
      hslLum: clampNumber(pipeline.color.hslLum, EDIT_PARAMETER_RANGES.hsl.luminance),

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

export function mergePipeline(pipeline: EditPipeline, patch: PipelinePatch): EditPipeline {
  return normalizePipeline({
    transform: { ...pipeline.transform, ...patch.transform },
    color: {
      ...pipeline.color,
      ...patch.color,
      curve: mergeCurve(pipeline.color.curve, patch.color?.curve),
    },
    effects: { ...pipeline.effects, ...patch.effects },
    watermark: { ...pipeline.watermark, ...patch.watermark },
  })
}

export function serializePipeline(pipeline: EditPipeline): string {
  return JSON.stringify(pipeline)
}

export function deserializePipeline(value: string): EditPipeline {
  const parsed = JSON.parse(value) as PipelinePatch
  return mergePipeline(createDefaultPipeline(), parsed)
}
