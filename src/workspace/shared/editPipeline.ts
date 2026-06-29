export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface EditPipeline {
  transform: {
    crop: CropRect | null
    rotate: number
    flipH: boolean
    flipV: boolean
    scale: number
  }
  color: {
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
    hsl: Record<ColorMixChannel, HslAdjust>
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
    lensDistortion: number
    lensVignetting: number
    chromaticAberration: number
  }
  watermark: {
    enabled: boolean
    styleId: string | null
    customImagePath: string | null
    opacity: number
    size: number
    position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'
  }
}

export type ColorMixChannel = 'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta'
export type SelectiveColorChannel = 'red' | 'yellow' | 'green' | 'cyan' | 'blue' | 'magenta' | 'white' | 'neutral' | 'black'

export interface HslAdjust {
  hue: number
  saturation: number
  luminance: number
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
const SELECTIVE_COLOR_CHANNELS: SelectiveColorChannel[] = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'white', 'neutral', 'black']

function createDefaultHsl(): Record<ColorMixChannel, HslAdjust> {
  return Object.fromEntries(COLOR_MIX_CHANNELS.map((channel) => [channel, { hue: 0, saturation: 0, luminance: 0 }])) as Record<ColorMixChannel, HslAdjust>
}

function createDefaultSelectiveColor(): Record<SelectiveColorChannel, SelectiveColorAdjust> {
  return Object.fromEntries(SELECTIVE_COLOR_CHANNELS.map((channel) => [channel, { cyan: 0, magenta: 0, yellow: 0, black: 0 }])) as Record<SelectiveColorChannel, SelectiveColorAdjust>
}

export const DEFAULT_PIPELINE: EditPipeline = {
  transform: {
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1,
  },
  color: {
    exposure: 0,
    contrast: 0,
    brightness: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    hsl: createDefaultHsl(),
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
    lensDistortion: 0,
    lensVignetting: 0,
    chromaticAberration: 0,
  },
  watermark: {
    enabled: false,
    styleId: null,
    customImagePath: null,
    opacity: 100,
    size: 15,
    position: 'bottomRight',
  },
}

export function createDefaultPipeline(): EditPipeline {
  return structuredClone(DEFAULT_PIPELINE)
}

export function mergePipeline(pipeline: EditPipeline, patch: PipelinePatch): EditPipeline {
  const nextColor = { ...pipeline.color, ...patch.color }
  const nextEffects = { ...pipeline.effects, ...patch.effects }
  return {
    transform: { ...pipeline.transform, ...patch.transform },
    color: {
      ...nextColor,
      hsl: { ...pipeline.color.hsl, ...patch.color?.hsl },
      grading: { ...pipeline.color.grading, ...patch.color?.grading },
      selectiveColor: { ...pipeline.color.selectiveColor, ...patch.color?.selectiveColor },
      calibration: { ...pipeline.color.calibration, ...patch.color?.calibration },
    },
    effects: nextEffects,
    watermark: { ...pipeline.watermark, ...patch.watermark },
  }
}

export function serializePipeline(pipeline: EditPipeline): string {
  return JSON.stringify(pipeline)
}

export function deserializePipeline(value: string): EditPipeline {
  const parsed = JSON.parse(value) as PipelinePatch
  return mergePipeline(createDefaultPipeline(), parsed)
}
