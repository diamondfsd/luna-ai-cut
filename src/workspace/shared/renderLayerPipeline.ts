import type { PreviewLayer, RenderColorAdjustments, RenderLayerTransform } from '../../shared/types'
import type { BorderSettings } from './editPipeline'
import { HSL_CHANNELS, type EditPipeline } from './editPipeline'
import { shouldSwapOrientation } from '../transform/cropGeometry'

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

/** 调整裁剪结果所在的画布矩形，因此不会改写或重新解释已有裁剪区域。 */
export function applyBorderMediaLayout(
  layer: PreviewLayer,
  border: BorderSettings,
): PreviewLayer {
  if (!border.enabled) return layer
  const scale = border.mediaScale / 100
  const width = layer.dstW * scale
  const height = layer.dstH * scale
  return {
    ...layer,
    dstX: layer.dstX + (layer.dstW - width) / 2 + layer.dstW * border.mediaOffsetX / 100,
    dstY: layer.dstY + (layer.dstH - height) / 2 + layer.dstH * border.mediaOffsetY / 100,
    dstW: width,
    dstH: height,
  }
}

/** 裁剪/直角旋转后的实际画布尺寸，避免把新比例重新塞回原始画布。 */
export function outputSizeForTransform(
  source: { width: number; height: number },
  transform: EditPipeline['transform'],
): { width: number; height: number } {
  const swapped = shouldSwapOrientation(transform.orientation)
  const frameWidth = swapped ? source.height : source.width
  const frameHeight = swapped ? source.width : source.height
  const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  return {
    width: Math.max(1, Math.round(frameWidth * crop.w)),
    height: Math.max(1, Math.round(frameHeight * crop.h)),
  }
}
