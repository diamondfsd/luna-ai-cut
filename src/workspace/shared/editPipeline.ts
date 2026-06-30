import type { WatermarkSettings } from '../../shared/types'
import { EDIT_PARAMETER_RANGES, clampNumber } from './editParameterRanges'

export interface CropRect {
  x: number
  y: number
  w: number
  h: number
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
    whiteBalanceMode: WhiteBalanceMode
    exposure: number
    contrast: number
    brightness: number
    saturation: number
    vibrance: number
    temperature: number
    tint: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    texture: number
    clarity: number
    dehaze: number
    curve: ToneCurveAdjust
    hsl: Record<ColorMixChannel, HslAdjust>
    colorEditor: ColorEditorAdjust
    grading: {
      shadowsHue: number
      shadowsSaturation: number
      midtonesHue: number
      midtonesSaturation: number
      highlightsHue: number
      highlightsSaturation: number
      blending: number
      balance: number
    }
    selectiveColorMode: SelectiveColorMode
    selectiveColor: Record<SelectiveColorChannel, SelectiveColorAdjust>
    calibration: {
      redHue: number
      redSaturation: number
      greenHue: number
      greenSaturation: number
      blueHue: number
      blueSaturation: number
    }
  }
  effects: {
    sharpen: number
    sharpenRadius: number
    sharpenDetail: number
    sharpenMasking: number
    noiseReduction: number
    colorNoiseReduction: number
    vignette: number
    grainAmount: number
    grainSize: number
    grainRoughness: number
    lensVignetting: number
    chromaticAberration: number
  }
  watermark: WatermarkSettings
}

export type WhiteBalanceMode = 'auto' | 'custom' | 'daylight' | 'cloudy' | 'indoor'
export type ToneCurveChannel = 'rgb' | 'luminance' | 'red' | 'green' | 'blue'
export type ColorMixChannel = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta'
export type SelectiveColorChannel = 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta' | 'white' | 'neutral' | 'black'
export type SelectiveColorMode = 'relative' | 'absolute'

export interface ToneCurveBandAdjust {
  shadows: number
  darks: number
  lights: number
  highlights: number
}

export interface ToneCurveAdjust {
  activeChannel: ToneCurveChannel
  channels: Record<ToneCurveChannel, ToneCurveBandAdjust>
}

export interface HslAdjust {
  hue: number
  saturation: number
  luminance: number
}

export interface ColorEditorAdjust {
  hue: number
  saturation: number
  smoothing: number
  luminanceSmoothing: number
  hueOffset: number
  saturationOffset: number
  brightnessOffset: number
  uniformity: number
}

export interface SelectiveColorAdjust {
  cyan: number
  magenta: number
  yellow: number
  black: number
}

export type PipelinePatch = {
  transform?: Partial<EditPipeline['transform']>
  color?: Partial<EditPipeline['color']>
  effects?: Partial<EditPipeline['effects']>
  watermark?: Partial<EditPipeline['watermark']>
}

const COLOR_MIX_CHANNELS: ColorMixChannel[] = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta']
const TONE_CURVE_CHANNELS: ToneCurveChannel[] = ['rgb', 'luminance', 'red', 'green', 'blue']
const SELECTIVE_COLOR_CHANNELS: SelectiveColorChannel[] = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white', 'neutral', 'black']

export function createDefaultCurveBand(): ToneCurveBandAdjust {
  return {
    shadows: 0,
    darks: 0,
    lights: 0,
    highlights: 0,
  }
}

export function createDefaultCurve(): ToneCurveAdjust {
  return {
    activeChannel: 'rgb',
    channels: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [channel, createDefaultCurveBand()])) as Record<ToneCurveChannel, ToneCurveBandAdjust>,
  }
}

export function createDefaultHsl(): Record<ColorMixChannel, HslAdjust> {
  return Object.fromEntries(COLOR_MIX_CHANNELS.map((channel) => [channel, { hue: 0, saturation: 0, luminance: 0 }])) as Record<ColorMixChannel, HslAdjust>
}

export function createDefaultSelectiveColor(): Record<SelectiveColorChannel, SelectiveColorAdjust> {
  return Object.fromEntries(SELECTIVE_COLOR_CHANNELS.map((channel) => [channel, { cyan: 0, magenta: 0, yellow: 0, black: 0 }])) as Record<SelectiveColorChannel, SelectiveColorAdjust>
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
    contrast: 0,
    brightness: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 5500,
    tint: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    curve: createDefaultCurve(),
    hsl: createDefaultHsl(),
    colorEditor: {
      hue: 224,
      saturation: 54,
      smoothing: 50,
      luminanceSmoothing: 50,
      hueOffset: 0,
      saturationOffset: 0,
      brightnessOffset: 0,
      uniformity: 0,
    },
    grading: {
      shadowsHue: 220,
      shadowsSaturation: 0,
      midtonesHue: 40,
      midtonesSaturation: 0,
      highlightsHue: 45,
      highlightsSaturation: 0,
      blending: 50,
      balance: 0,
    },
    selectiveColorMode: 'relative',
    selectiveColor: createDefaultSelectiveColor(),
    calibration: {
      redHue: 0,
      redSaturation: 0,
      greenHue: 0,
      greenSaturation: 0,
      blueHue: 0,
      blueSaturation: 0,
    },
  },
  effects: {
    sharpen: 0,
    sharpenRadius: 1,
    sharpenDetail: 25,
    sharpenMasking: 0,
    noiseReduction: 0,
    colorNoiseReduction: 0,
    vignette: 0,
    grainAmount: 0,
    grainSize: 25,
    grainRoughness: 50,
    lensVignetting: 0,
    chromaticAberration: 0,
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

// Per-group default values — single source of truth for reset buttons
export const WHITE_BALANCE_DEFAULTS: Partial<EditPipeline['color']> = {
  whiteBalanceMode: 'custom',
  temperature: 5500,
  tint: 0,
}

export const TONE_DEFAULTS: Partial<EditPipeline['color']> = {
  exposure: 0,
  contrast: 0,
  brightness: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
}

export const CURVE_DEFAULTS: Partial<EditPipeline['color']> = {
  curve: createDefaultCurve(),
}

export const HSL_DEFAULTS: Partial<EditPipeline['color']> = {
  hsl: createDefaultHsl(),
}

export const COLOR_EDITOR_DEFAULTS: Partial<EditPipeline['color']> = {
  colorEditor: DEFAULT_PIPELINE.color.colorEditor,
}

export const GRADING_DEFAULTS: Partial<EditPipeline['color']> = {
  grading: DEFAULT_PIPELINE.color.grading,
}

export const SELECTIVE_COLOR_DEFAULTS: Partial<EditPipeline['color']> = {
  selectiveColor: createDefaultSelectiveColor(),
  selectiveColorMode: 'relative',
}

export const CALIBRATION_DEFAULTS: Partial<EditPipeline['color']> = {
  calibration: DEFAULT_PIPELINE.color.calibration,
}

export const DETAIL_DEFAULTS: Partial<EditPipeline['effects']> = {
  sharpen: 0,
  sharpenRadius: 1,
  sharpenDetail: 25,
  sharpenMasking: 0,
  noiseReduction: 0,
  colorNoiseReduction: 0,
}

export const GRAIN_DEFAULTS: Partial<EditPipeline['effects']> = {
  grainAmount: 0,
  grainSize: 25,
  grainRoughness: 50,
}

export const LENS_DEFAULTS: Partial<EditPipeline['effects']> = {
  lensVignetting: 0,
  vignette: 0,
  chromaticAberration: 0,
}

function mergeCurve(current: ToneCurveAdjust, patch?: Partial<ToneCurveAdjust> | null): ToneCurveAdjust {
  if (!patch) return current
  const legacyPatch = patch as Partial<ToneCurveBandAdjust> & { channel?: ToneCurveChannel }
  if (!patch.channels && ('channel' in legacyPatch || 'shadows' in legacyPatch || 'darks' in legacyPatch || 'lights' in legacyPatch || 'highlights' in legacyPatch)) {
    const activeChannel = legacyPatch.channel ?? current.activeChannel
    return {
      activeChannel,
      channels: {
        ...current.channels,
        [activeChannel]: {
          ...current.channels[activeChannel],
          shadows: legacyPatch.shadows ?? current.channels[activeChannel].shadows,
          darks: legacyPatch.darks ?? current.channels[activeChannel].darks,
          lights: legacyPatch.lights ?? current.channels[activeChannel].lights,
          highlights: legacyPatch.highlights ?? current.channels[activeChannel].highlights,
        },
      },
    }
  }
  return {
    activeChannel: patch.activeChannel ?? current.activeChannel,
    channels: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => [
      channel,
      { ...current.channels[channel], ...patch.channels?.[channel] },
    ])) as Record<ToneCurveChannel, ToneCurveBandAdjust>,
  }
}

function mergeHsl(
  current: Record<ColorMixChannel, HslAdjust>,
  patch?: Partial<Record<ColorMixChannel, Partial<HslAdjust>>> | null,
): Record<ColorMixChannel, HslAdjust> {
  return Object.fromEntries(COLOR_MIX_CHANNELS.map((channel) => [
    channel,
    { ...current[channel], ...patch?.[channel] },
  ])) as Record<ColorMixChannel, HslAdjust>
}

function mergeSelectiveColor(
  current: Record<SelectiveColorChannel, SelectiveColorAdjust>,
  patch?: Partial<Record<SelectiveColorChannel, Partial<SelectiveColorAdjust>>> | null,
): Record<SelectiveColorChannel, SelectiveColorAdjust> {
  return Object.fromEntries(SELECTIVE_COLOR_CHANNELS.map((channel) => [
    channel,
    { ...current[channel], ...patch?.[channel] },
  ])) as Record<SelectiveColorChannel, SelectiveColorAdjust>
}

function normalizeCurve(curve: ToneCurveAdjust): ToneCurveAdjust {
  const range = EDIT_PARAMETER_RANGES.curve.band
  return {
    activeChannel: TONE_CURVE_CHANNELS.includes(curve.activeChannel) ? curve.activeChannel : 'rgb',
    channels: Object.fromEntries(TONE_CURVE_CHANNELS.map((channel) => {
      const band = curve.channels[channel]
      return [channel, {
        shadows: clampNumber(band.shadows, range),
        darks: clampNumber(band.darks, range),
        lights: clampNumber(band.lights, range),
        highlights: clampNumber(band.highlights, range),
      }]
    })) as Record<ToneCurveChannel, ToneCurveBandAdjust>,
  }
}

function normalizePipeline(pipeline: EditPipeline): EditPipeline {
  const color = EDIT_PARAMETER_RANGES.color
  const colorEditor = EDIT_PARAMETER_RANGES.colorEditor
  const grading = EDIT_PARAMETER_RANGES.grading
  const selectiveColor = EDIT_PARAMETER_RANGES.selectiveColor
  const calibration = EDIT_PARAMETER_RANGES.calibration
  const effects = EDIT_PARAMETER_RANGES.effects

  return {
    ...pipeline,
    color: {
      ...pipeline.color,
      whiteBalanceMode: ['auto', 'custom', 'daylight', 'cloudy', 'indoor'].includes(pipeline.color.whiteBalanceMode) ? pipeline.color.whiteBalanceMode : 'custom',
      temperature: clampNumber(Math.abs(pipeline.color.temperature) <= 100 ? 5500 + pipeline.color.temperature * 45 : pipeline.color.temperature, color.temperature),
      tint: clampNumber(pipeline.color.tint, color.tint),
      exposure: clampNumber(pipeline.color.exposure, color.exposure),
      contrast: clampNumber(pipeline.color.contrast, color.contrast),
      brightness: clampNumber(pipeline.color.brightness, color.brightness),
      highlights: clampNumber(pipeline.color.highlights, color.highlights),
      shadows: clampNumber(pipeline.color.shadows, color.shadows),
      whites: clampNumber(pipeline.color.whites, color.whites),
      blacks: clampNumber(pipeline.color.blacks, color.blacks),
      texture: clampNumber(pipeline.color.texture, color.texture),
      clarity: clampNumber(pipeline.color.clarity, color.clarity),
      dehaze: clampNumber(pipeline.color.dehaze, color.dehaze),
      vibrance: clampNumber(pipeline.color.vibrance, color.vibrance),
      saturation: clampNumber(pipeline.color.saturation, color.saturation),
      curve: normalizeCurve(pipeline.color.curve),
      hsl: Object.fromEntries(COLOR_MIX_CHANNELS.map((channel) => {
        const item = pipeline.color.hsl[channel]
        return [channel, {
          hue: clampNumber(item.hue, EDIT_PARAMETER_RANGES.hsl.hue),
          saturation: clampNumber(item.saturation, EDIT_PARAMETER_RANGES.hsl.saturation),
          luminance: clampNumber(item.luminance, EDIT_PARAMETER_RANGES.hsl.luminance),
        }]
      })) as Record<ColorMixChannel, HslAdjust>,
      colorEditor: {
        hue: clampNumber(pipeline.color.colorEditor.hue, colorEditor.hue),
        saturation: clampNumber(pipeline.color.colorEditor.saturation, colorEditor.saturation),
        smoothing: clampNumber(pipeline.color.colorEditor.smoothing, colorEditor.smoothing),
        luminanceSmoothing: clampNumber(pipeline.color.colorEditor.luminanceSmoothing, colorEditor.luminanceSmoothing),
        hueOffset: clampNumber(pipeline.color.colorEditor.hueOffset, colorEditor.hueOffset),
        saturationOffset: clampNumber(pipeline.color.colorEditor.saturationOffset, colorEditor.saturationOffset),
        brightnessOffset: clampNumber(pipeline.color.colorEditor.brightnessOffset, colorEditor.brightnessOffset),
        uniformity: clampNumber(pipeline.color.colorEditor.uniformity, colorEditor.uniformity),
      },
      grading: {
        shadowsHue: clampNumber(pipeline.color.grading.shadowsHue, grading.shadowsHue),
        shadowsSaturation: clampNumber(pipeline.color.grading.shadowsSaturation, grading.shadowsSaturation),
        midtonesHue: clampNumber(pipeline.color.grading.midtonesHue, grading.midtonesHue),
        midtonesSaturation: clampNumber(pipeline.color.grading.midtonesSaturation, grading.midtonesSaturation),
        highlightsHue: clampNumber(pipeline.color.grading.highlightsHue, grading.highlightsHue),
        highlightsSaturation: clampNumber(pipeline.color.grading.highlightsSaturation, grading.highlightsSaturation),
        blending: clampNumber(pipeline.color.grading.blending, grading.blending),
        balance: clampNumber(pipeline.color.grading.balance, grading.balance),
      },
      selectiveColorMode: pipeline.color.selectiveColorMode === 'absolute' ? 'absolute' : 'relative',
      selectiveColor: Object.fromEntries(SELECTIVE_COLOR_CHANNELS.map((channel) => {
        const item = pipeline.color.selectiveColor[channel]
        return [channel, {
          cyan: clampNumber(item.cyan, selectiveColor.cyan),
          magenta: clampNumber(item.magenta, selectiveColor.magenta),
          yellow: clampNumber(item.yellow, selectiveColor.yellow),
          black: clampNumber(item.black, selectiveColor.black),
        }]
      })) as Record<SelectiveColorChannel, SelectiveColorAdjust>,
      calibration: {
        redHue: clampNumber(pipeline.color.calibration.redHue, calibration.redHue),
        redSaturation: clampNumber(pipeline.color.calibration.redSaturation, calibration.redSaturation),
        greenHue: clampNumber(pipeline.color.calibration.greenHue, calibration.greenHue),
        greenSaturation: clampNumber(pipeline.color.calibration.greenSaturation, calibration.greenSaturation),
        blueHue: clampNumber(pipeline.color.calibration.blueHue, calibration.blueHue),
        blueSaturation: clampNumber(pipeline.color.calibration.blueSaturation, calibration.blueSaturation),
      },
    },
    effects: {
      sharpen: clampNumber(pipeline.effects.sharpen, effects.sharpen),
      sharpenRadius: clampNumber(pipeline.effects.sharpenRadius, effects.sharpenRadius),
      sharpenDetail: clampNumber(pipeline.effects.sharpenDetail, effects.sharpenDetail),
      sharpenMasking: clampNumber(pipeline.effects.sharpenMasking, effects.sharpenMasking),
      noiseReduction: clampNumber(pipeline.effects.noiseReduction, effects.noiseReduction),
      colorNoiseReduction: clampNumber(pipeline.effects.colorNoiseReduction, effects.colorNoiseReduction),
      vignette: clampNumber(pipeline.effects.vignette, effects.vignette),
      grainAmount: clampNumber(pipeline.effects.grainAmount, effects.grainAmount),
      grainSize: clampNumber(pipeline.effects.grainSize, effects.grainSize),
      grainRoughness: clampNumber(pipeline.effects.grainRoughness, effects.grainRoughness),
      lensVignetting: clampNumber(pipeline.effects.lensVignetting, effects.lensVignetting),
      chromaticAberration: clampNumber(pipeline.effects.chromaticAberration, effects.chromaticAberration),
    },
  }
}

export function mergePipeline(pipeline: EditPipeline, patch: PipelinePatch): EditPipeline {
  const nextColor = { ...pipeline.color, ...patch.color }
  const nextEffects = { ...pipeline.effects, ...patch.effects }
  return normalizePipeline({
    transform: { ...pipeline.transform, ...patch.transform },
    color: {
      ...nextColor,
      curve: mergeCurve(pipeline.color.curve, patch.color?.curve),
      hsl: mergeHsl(pipeline.color.hsl, patch.color?.hsl),
      colorEditor: { ...pipeline.color.colorEditor, ...patch.color?.colorEditor },
      grading: { ...pipeline.color.grading, ...patch.color?.grading },
      selectiveColorMode: patch.color?.selectiveColorMode ?? pipeline.color.selectiveColorMode,
      selectiveColor: mergeSelectiveColor(pipeline.color.selectiveColor, patch.color?.selectiveColor),
      calibration: { ...pipeline.color.calibration, ...patch.color?.calibration },
    },
    effects: nextEffects,
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
