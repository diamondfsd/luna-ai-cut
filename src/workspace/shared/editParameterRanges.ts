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

const signedPercent = { min: -100, max: 100 } as const

export const EDIT_PARAMETER_RANGES = {
  color: {
    temperature: signedPercent,
    tint: signedPercent,
    exposure: { min: -5, max: 5, step: 0.01 },
    black: signedPercent,
    contrast: signedPercent,
    saturation: signedPercent,
    vibrance: signedPercent,
    highlights: signedPercent,
    shadows: signedPercent,
    whites: signedPercent,
    blacks: signedPercent,
    clarity: signedPercent,
    texture: signedPercent,
    curveLift: { min: -50, max: 50 },
    curveContrast: signedPercent,
    sharpen: { min: 0, max: 200, step: 1 },
    denoise: { min: 0, max: 100 },
  },
  curve: {
    point: { min: 0, max: 1, step: 0.001 },
  },
  levels: {
    black: { min: 0, max: 0.95, step: 0.001 },
    gray: { min: 0.05, max: 0.95, step: 0.001 },
    white: { min: 0.05, max: 1.5, step: 0.001 },
  },
  hsl: {
    hue: { min: -180, max: 180, step: 1 },
    hslHue: { min: 0, max: 360, step: 1 },
    saturation: signedPercent,
    luminance: signedPercent,
  },
  grading: {
    hue: { min: 0, max: 360 },
    amount: signedPercent,
  },
  effects: {
    sharpen: { min: 0, max: 100 },
    denoise: { min: 0, max: 100 },
  },
} as const
