import type { EditPipeline } from './editPipeline'

export type ColorLutParams = Pick<EditPipeline['color'],
  | 'exposure'
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'vibrance'
  | 'temperature'
  | 'tint'
  | 'shadows'
  | 'highlights'
  | 'whites'
  | 'blacks'
  | 'levelsBlack'
  | 'levelsGray'
  | 'levelsWhite'
  | 'gradeShadowsAmount'
  | 'gradeShadowsHue'
  | 'gradeMidAmount'
  | 'gradeMidHue'
  | 'gradeHighlightsAmount'
  | 'gradeHighlightsHue'
  | 'hue'
  | 'hslHue'
  | 'hslSat'
  | 'hslLum'
  | 'curve'
>

export function buildColorLutParams(color: EditPipeline['color']): ColorLutParams {
  return {
    exposure: color.exposure,
    brightness: color.brightness,
    contrast: color.contrast,
    saturation: color.saturation,
    vibrance: color.vibrance,
    temperature: color.temperature,
    tint: color.tint,
    shadows: color.shadows,
    highlights: color.highlights,
    whites: color.whites,
    blacks: color.blacks,
    levelsBlack: color.levelsBlack,
    levelsGray: color.levelsGray,
    levelsWhite: color.levelsWhite,
    gradeShadowsAmount: color.gradeShadowsAmount,
    gradeShadowsHue: color.gradeShadowsHue,
    gradeMidAmount: color.gradeMidAmount,
    gradeMidHue: color.gradeMidHue,
    gradeHighlightsAmount: color.gradeHighlightsAmount,
    gradeHighlightsHue: color.gradeHighlightsHue,
    hue: color.hue,
    hslHue: color.hslHue,
    hslSat: color.hslSat,
    hslLum: color.hslLum,
    curve: color.curve,
  }
}

export function colorLutKey(color: EditPipeline['color']): string {
  return JSON.stringify(buildColorLutParams(color))
}
