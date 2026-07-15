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
    hslChannels: [
      ...HSL_CHANNELS.map((channel) => color.hslChannels[channel.key]),
      ...color.customHslChannels,
    ],
  }
}

/** 将局部参数作为相对调整叠加到全局调色。 */
export function pipelineColorWithLocalAdjustments(
  globalColor: EditPipeline['color'],
  localColor: EditPipeline['color'],
): RenderColorAdjustments {
  const global = pipelineColorToRenderColor(globalColor)
  const local = pipelineColorToRenderColor(localColor)
  const combined = { ...global }
  const additive = [
    'exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint',
    'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'texture', 'sharpen', 'denoise',
    'curveLift', 'curveContrast', 'gradeShadowsAmount', 'gradeMidAmount', 'gradeHighlightsAmount',
  ] as const
  for (const key of additive) combined[key] = global[key] + local[key]
  combined.levelsBlack = global.levelsBlack + local.levelsBlack
  combined.levelsGray = global.levelsGray + local.levelsGray - 0.5
  combined.levelsWhite = global.levelsWhite + local.levelsWhite - 1
  if (local.gradeShadowsAmount !== 0) combined.gradeShadowsHue = local.gradeShadowsHue
  if (local.gradeMidAmount !== 0) combined.gradeMidHue = local.gradeMidHue
  if (local.gradeHighlightsAmount !== 0) combined.gradeHighlightsHue = local.gradeHighlightsHue
  combined.curve = {
    rgb: local.curve.rgb.length ? local.curve.rgb : global.curve.rgb,
    luminance: local.curve.luminance.length ? local.curve.luminance : global.curve.luminance,
    red: local.curve.red.length ? local.curve.red : global.curve.red,
    green: local.curve.green.length ? local.curve.green : global.curve.green,
    blue: local.curve.blue.length ? local.curve.blue : global.curve.blue,
  }
  combined.hslChannels = global.hslChannels.map((channel, index) => ({
    ...channel,
    hueShift: channel.hueShift + (local.hslChannels[index]?.hueShift ?? 0),
    saturation: channel.saturation + (local.hslChannels[index]?.saturation ?? 0),
    luminance: channel.luminance + (local.hslChannels[index]?.luminance ?? 0),
  }))
  return combined
}

export function buildLocalColorLayers(base: PreviewLayer, pipeline: EditPipeline): PreviewLayer[] {
  return pipeline.colorMasks.filter((layer) => layer.enabled).reverse().map((layer) => ({
    ...base,
    color: pipelineColorWithLocalAdjustments(pipeline.color, layer.color),
    maskPath: layer.path,
    maskOpacity: layer.opacity,
    maskInverted: layer.inverted,
    maskFeather: layer.feather,
  }))
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
