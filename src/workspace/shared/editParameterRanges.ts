export interface NumberParameterRange {
  min: number
  max: number
  step?: number
  uiMin?: number
  uiMax?: number
  uiStep?: number
}

export function clampNumber(value: number, range: NumberParameterRange): number {
  if (!Number.isFinite(value)) return range.min <= 0 && range.max >= 0 ? 0 : range.min
  return Math.min(range.max, Math.max(range.min, value))
}

export function sliderRange(range: NumberParameterRange): { min: number; max: number; step?: number } {
  return {
    min: range.uiMin ?? range.min,
    max: range.uiMax ?? range.max,
    step: range.uiStep ?? range.step,
  }
}

const signed = { min: -100, max: 100 } as const
const positive = { min: 0, max: 100 } as const

export const EDIT_PARAMETER_RANGES = {
  color: {
    temperature: { min: 2000, max: 15000, step: 50 },
    tint: signed,
    exposure: { min: -5, max: 5, step: 0.01 },
    contrast: signed,
    brightness: signed,
    highlights: signed,
    shadows: signed,
    whites: signed,
    blacks: signed,
    texture: signed,
    clarity: signed,
    dehaze: { min: -100, max: 100, uiMin: -60, uiMax: 60 },
    vibrance: signed,
    saturation: signed,
  },
  curve: {
    band: { min: -100, max: 100, uiMin: -75, uiMax: 75 },
  },
  hsl: {
    hue: signed,
    saturation: signed,
    luminance: signed,
  },
  colorEditor: {
    hue: { min: 0, max: 360 },
    saturation: positive,
    smoothing: positive,
    luminanceSmoothing: positive,
    hueOffset: signed,
    saturationOffset: signed,
    brightnessOffset: signed,
    uniformity: positive,
  },
  grading: {
    shadowsHue: { min: 0, max: 360 },
    shadowsSaturation: positive,
    midtonesHue: { min: 0, max: 360 },
    midtonesSaturation: positive,
    highlightsHue: { min: 0, max: 360 },
    highlightsSaturation: positive,
    blending: positive,
    balance: signed,
  },
  selectiveColor: {
    cyan: signed,
    magenta: signed,
    yellow: signed,
    black: signed,
  },
  calibration: {
    redHue: signed,
    redSaturation: signed,
    greenHue: signed,
    greenSaturation: signed,
    blueHue: signed,
    blueSaturation: signed,
  },
  effects: {
    sharpen: { min: 0, max: 150, uiMax: 100 },
    sharpenRadius: { min: 0.5, max: 3, step: 0.1 },
    sharpenDetail: positive,
    sharpenMasking: positive,
    noiseReduction: positive,
    colorNoiseReduction: positive,
    vignette: signed,
    grainAmount: positive,
    grainSize: positive,
    grainRoughness: positive,
    lensVignetting: signed,
    chromaticAberration: positive,
  },
} as const
