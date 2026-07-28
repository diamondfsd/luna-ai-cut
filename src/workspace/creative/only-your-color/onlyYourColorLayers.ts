import type { PreviewLayer } from '../../../shared/types'
import { createDefaultPipeline } from '../../shared/editPipeline'
import { pipelineColorToRenderColor } from '../../shared/renderLayerPipeline'

interface OnlyYourColorLayerOptions {
  layers: PreviewLayer[]
  sourcePath: string
  subjectMaskPath: string
  backgroundMaskPath: string
  intensity: number
  backgroundExposure: number
  subjectSaturation: number
  subjectVibrance: number
  subjectMaskInverted?: boolean
  backgroundMaskInverted?: boolean
}

export function buildOnlyYourColorLayers(options: OnlyYourColorLayerOptions): PreviewLayer[] {
  const sourceLayers = options.layers.filter((layer) => (
    layer.filePath === options.sourcePath && layer.layoutRole === undefined
  ))
  const main = sourceLayers.find((layer) => layer.layerType === 'media') ?? sourceLayers[0]
  if (!main) return options.layers
  const precomposeGroup = 'only-your-color-source'
  const inputs: PreviewLayer[] = sourceLayers.map((layer, index) => ({
    ...layer,
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
    zIndex: index,
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
    cornerRadius: undefined,
  }))
  const flattened: PreviewLayer = {
    ...main,
    precomposeGroup,
    precomposeRole: 'output',
    color: undefined,
    restoreLutId: undefined,
    lutId: undefined,
    lutIntensity: undefined,
    maskPath: undefined,
    maskOpacity: undefined,
    maskInverted: undefined,
    maskFeather: undefined,
    zIndex: 0,
  }
  const neutralColor = pipelineColorToRenderColor(createDefaultPipeline().color)
  const effectAmount = Math.max(0, Math.min(100, options.intensity)) / 100
  const background: PreviewLayer = {
    ...flattened,
    layerType: 'local-color',
    color: {
      ...neutralColor,
      exposure: Math.max(-5, Math.min(5, options.backgroundExposure)),
      saturation: -100 * effectAmount,
    },
    maskPath: options.backgroundMaskPath,
    maskOpacity: 1,
    maskInverted: options.backgroundMaskInverted ?? true,
    maskFeather: 0,
    zIndex: 1,
  }
  const subject: PreviewLayer = {
    ...flattened,
    layerType: 'local-color',
    color: {
      ...neutralColor,
      saturation: options.subjectSaturation,
      vibrance: options.subjectVibrance,
    },
    maskPath: options.subjectMaskPath,
    maskOpacity: 1,
    maskInverted: options.subjectMaskInverted ?? false,
    maskFeather: 0,
    zIndex: 2,
  }
  const decorations = options.layers
    .filter((layer) => !sourceLayers.includes(layer))
    .map((layer, index) => ({ ...layer, zIndex: Math.max(20 + index, layer.zIndex) }))
  const subjectLayers = options.subjectSaturation === 0 && options.subjectVibrance === 0
    ? []
    : [subject]
  return [
    ...inputs,
    flattened,
    background,
    ...subjectLayers,
    ...decorations,
  ]
}
