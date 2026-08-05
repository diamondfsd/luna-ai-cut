import type { PreviewLayer, RenderColorAdjustments, RenderLayerTransform, WatermarkPositioning } from '../../shared/types'
import type { BorderSettings } from './editPipeline'
import { DEFAULT_PIPELINE, HSL_CHANNELS, type EditPipeline } from './editPipeline'
import { shouldSwapOrientation } from '../transform/cropGeometry'
import { beautyLayerColorForRendering, beautyLayerOpacityForRendering } from '../beauty/beautyLayers'

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
    glowStrength: color.glowStrength,
    glowRadius: color.glowRadius,
    glowThreshold: color.glowThreshold,
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
  return renderColorWithLocalAdjustments(
    pipelineColorToRenderColor(globalColor),
    pipelineColorToRenderColor(localColor),
  )
}

function renderColorWithLocalAdjustments(
  global: RenderColorAdjustments,
  local: RenderColorAdjustments,
): RenderColorAdjustments {
  const combined = { ...global }
  const additive = [
    'exposure', 'brightness', 'contrast', 'saturation', 'vibrance', 'temperature', 'tint',
    'highlights', 'shadows', 'whites', 'blacks', 'clarity', 'texture', 'sharpen', 'denoise',
    'glowStrength',
    'curveLift', 'curveContrast', 'gradeShadowsAmount', 'gradeMidAmount', 'gradeHighlightsAmount',
  ] as const
  for (const key of additive) combined[key] = global[key] + local[key]
  if (local.glowRadius !== DEFAULT_PIPELINE.color.glowRadius) combined.glowRadius = local.glowRadius
  if (local.glowThreshold !== DEFAULT_PIPELINE.color.glowThreshold) combined.glowThreshold = local.glowThreshold
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
  const videoBeautyMasks = base.isVideo
    ? pipeline.beautyMasks.filter((layer) => Boolean(layer.timeline?.frames.length))
    : pipeline.beautyMasks
  const adjustmentMasks = [...videoBeautyMasks, ...pipeline.colorMasks]
  return adjustmentMasks.filter((layer) => layer.enabled && !layer.loadError).reverse().map((layer) => ({
    ...base,
    layerType: 'local-color' as const,
    blendMode: layer.blendMode,
    color: renderColorWithLocalAdjustments(
      base.color ?? pipelineColorToRenderColor(pipeline.color),
      pipelineColorToRenderColor(beautyLayerColorForRendering(pipeline, layer)),
    ),
    maskPath: layer.path,
    maskOpacity: beautyLayerOpacityForRendering(pipeline, layer),
    maskInverted: layer.inverted,
    maskFeather: layer.components?.some((component) => component.type !== 'raster') ? 0 : layer.feather,
    maskTrack: layer.track,
    maskTimeline: layer.timeline,
  }))
}

/** 为相框中重复引用当前素材的媒体层补齐局部调色，Logo 等其他媒体不受影响。 */
export function applyLocalColorToSourceMediaLayers(
  layers: PreviewLayer[],
  sourcePath: string,
  pipeline: EditPipeline,
): PreviewLayer[] {
  const sourceLayers = layers.filter((layer) => (
    layer.layerType === 'media' && layer.filePath === sourcePath
  ))
  const hasBlurredBackground = sourceLayers.some((layer) => layer.layoutRole === 'background')
  const hasLocalColor = [...pipeline.colorMasks, ...pipeline.beautyMasks].some((layer) => layer.enabled && !layer.loadError)
  if (hasBlurredBackground && hasLocalColor) {
    const contentLayer = sourceLayers.find((layer) => layer.layoutRole === 'content')
      ?? sourceLayers.find((layer) => layer.layoutRole !== 'background')
    if (!contentLayer) return layers

    const precomposeGroup = 'framed-source-color'
    const inputBase: PreviewLayer = {
      ...contentLayer,
      layoutRole: undefined,
      precomposeGroup,
      precomposeRole: 'input',
      fit: 'stretch',
      dstX: 0,
      dstY: 0,
      dstW: 1,
      dstH: 1,
      srcX: 0,
      srcY: 0,
      srcW: 1,
      srcH: 1,
      opacity: 1,
      blendMode: 'normal',
      zIndex: 0,
      reveal: undefined,
      pixelStretch: undefined,
      cornerRadius: undefined,
      transform: {
        crop: null,
        orientation: 0,
        rotate: 0,
        flipH: false,
        flipV: false,
        scale: 1,
        translateX: 0,
        translateY: 0,
      },
      positioning: undefined,
    }
    const inputs = [
      inputBase,
      ...buildLocalColorLayers(inputBase, pipeline).map((layer, index) => ({
        ...layer,
        precomposeGroup,
        precomposeRole: 'input' as const,
        zIndex: index + 1,
      })),
    ]
    const outputs = layers.map((layer) => {
      if (layer.layerType !== 'media' || layer.filePath !== sourcePath) return layer
      return {
        ...layer,
        precomposeGroup,
        precomposeRole: 'output' as const,
        color: layer.layoutRole === 'background' ? layer.color : undefined,
        restoreLutId: undefined,
        lutId: undefined,
        lutIntensity: undefined,
      }
    })
    return [...inputs, ...outputs]
  }

  return layers.flatMap((layer) => (
    layer.layerType === 'media'
      && layer.filePath === sourcePath
      ? [layer, ...buildLocalColorLayers(layer, pipeline)]
      : [layer]
  ))
}

function mapSingleWatermarkPositioningToContent(
  positioning: WatermarkPositioning,
  contentLayer: PreviewLayer,
): WatermarkPositioning {
  const rightAnchored = positioning.anchor.endsWith('right')
  const bottomAnchored = positioning.anchor.startsWith('bottom')
  const marginX = positioning.marginX ?? 0
  const marginY = positioning.marginY ?? 0
  return {
    ...positioning,
    targetWidth: positioning.targetWidth * contentLayer.dstW,
    marginX: rightAnchored
      ? 1 - contentLayer.dstX - contentLayer.dstW + marginX * contentLayer.dstW
      : contentLayer.dstX + marginX * contentLayer.dstW,
    marginY: bottomAnchored
      ? 1 - contentLayer.dstY - contentLayer.dstH + marginY * contentLayer.dstH
      : contentLayer.dstY + marginY * contentLayer.dstH,
  }
}

function mapWatermarkPositioningToContent(
  positioning: NonNullable<PreviewLayer['positioning']>,
  contentLayer: PreviewLayer,
): NonNullable<PreviewLayer['positioning']> {
  if ('anchor' in positioning) {
    return mapSingleWatermarkPositioningToContent(positioning, contentLayer)
  }
  return {
    landscape: positioning.landscape
      ? mapSingleWatermarkPositioningToContent(positioning.landscape, contentLayer)
      : undefined,
    portrait: positioning.portrait
      ? mapSingleWatermarkPositioningToContent(positioning.portrait, contentLayer)
      : undefined,
  }
}

/** 柔焦相框中的水印以清晰主图为画布，而不是以整张柔焦背景为画布。 */
export function placeWatermarkOnFramedContent(
  watermarkLayers: PreviewLayer[],
  borderLayers: PreviewLayer[],
): PreviewLayer[] {
  const hasBlurredBackground = borderLayers.some((layer) => layer.layoutRole === 'background')
  const contentLayer = borderLayers.find((layer) => layer.layoutRole === 'content')
  if (!hasBlurredBackground || !contentLayer) return watermarkLayers

  return watermarkLayers.map((layer) => {
    const positioning = layer.positioning
    if (!positioning) {
      return {
        ...layer,
        dstX: contentLayer.dstX + layer.dstX * contentLayer.dstW,
        dstY: contentLayer.dstY + layer.dstY * contentLayer.dstH,
        dstW: layer.dstW * contentLayer.dstW,
        dstH: layer.dstH * contentLayer.dstH,
        zIndex: (contentLayer.zIndex ?? 0) + 1,
      }
    }

    return {
      ...layer,
      zIndex: (contentLayer.zIndex ?? 0) + 1,
      positioning: mapWatermarkPositioningToContent(positioning, contentLayer),
    }
  })
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
