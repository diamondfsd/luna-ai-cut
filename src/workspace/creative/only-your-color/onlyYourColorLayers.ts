import type { PreviewLayer } from '../../../shared/types'

interface OnlyYourColorLayerOptions {
  layers: PreviewLayer[]
  sourcePath: string
  subjectMaskPath: string
  backgroundMaskPath: string
  intensity: number
  subjectSaturation: number
  subjectMaskInverted?: boolean
  backgroundMaskInverted?: boolean
  subjectMaskFeather?: number
  backgroundMaskFeather?: number
}

export function buildOnlyYourColorLayers(options: OnlyYourColorLayerOptions): PreviewLayer[] {
  const main = options.layers.find((layer) => layer.filePath === options.sourcePath)
  if (!main) return options.layers
  const sourceTop = Math.max(...options.layers
    .filter((layer) => layer.filePath === options.sourcePath)
    .map((layer) => layer.zIndex))
  const baseSaturation = main.color?.saturation ?? 0
  const effectAmount = Math.max(0, Math.min(100, options.intensity)) / 100
  const background: PreviewLayer = {
    ...main,
    layerType: 'local-color',
    color: main.color ? {
      ...main.color,
      saturation: baseSaturation + (-100 - baseSaturation) * effectAmount,
    } : main.color,
    maskPath: options.backgroundMaskPath,
    maskOpacity: 1,
    maskInverted: options.backgroundMaskInverted ?? true,
    maskFeather: options.backgroundMaskFeather ?? 1,
    zIndex: sourceTop + 0.01,
  }
  const subject: PreviewLayer = {
    ...main,
    layerType: 'local-color',
    color: main.color ? {
      ...main.color,
      saturation: Math.max(-100, Math.min(100, baseSaturation + options.subjectSaturation)),
    } : main.color,
    maskPath: options.subjectMaskPath,
    maskOpacity: 1,
    maskInverted: options.subjectMaskInverted ?? false,
    maskFeather: options.subjectMaskFeather ?? 1,
    zIndex: sourceTop + 0.02,
  }
  const decorations = options.layers
    .filter((layer) => layer.filePath !== options.sourcePath)
    .map((layer, index) => ({ ...layer, zIndex: Math.max(20 + index, layer.zIndex) }))
  return [
    ...options.layers.filter((layer) => layer.filePath === options.sourcePath),
    background,
    subject,
    ...decorations,
  ]
}
