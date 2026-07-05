import type { RenderColorAdjustments, RenderLayerTransform } from '../../shared/types'
import { HSL_CHANNELS, type EditPipeline } from './editPipeline'

export function pipelineColorToRenderColor(color: EditPipeline['color']): RenderColorAdjustments {
  return {
    exposure: color.exposure,
    black: 0,
    brightness: color.brightness,
    contrast: color.contrast,
    saturation: color.saturation,
    vibrance: color.vibrance,
    temperature: color.temperature,
    tint: color.tint,
    highlights: color.highlights,
    shadows: color.shadows,
    whites: color.whites,
    blacks: color.blacks,
    clarity: color.clarity,
    texture: color.texture,
    sharpen: color.sharpen,
    denoise: color.denoise,
    gradeShadowsHue: color.gradeShadowsHue,
    gradeShadowsAmount: color.gradeShadowsAmount,
    gradeMidHue: color.gradeMidHue,
    gradeMidAmount: color.gradeMidAmount,
    gradeHighlightsHue: color.gradeHighlightsHue,
    gradeHighlightsAmount: color.gradeHighlightsAmount,
    curveLift: color.curveLift,
    curveContrast: color.curveContrast,
    curve: {
      rgb: color.curve.points.rgb,
      luminance: color.curve.points.luminance,
      red: color.curve.points.red,
      green: color.curve.points.green,
      blue: color.curve.points.blue,
    },
    levelsBlack: color.levelsBlack,
    levelsGray: color.levelsGray,
    levelsWhite: color.levelsWhite,
    hslChannels: HSL_CHANNELS.map((channel) => color.hslChannels[channel.key]),
  }
}

export function pipelineTransformToRenderTransform(transform: EditPipeline['transform']): RenderLayerTransform {
  return {
    crop: transform.crop,
    orientation: transform.orientation,
    rotate: transform.rotate,
    flipH: transform.flipH,
    flipV: transform.flipV,
    scale: transform.scale,
  }
}
