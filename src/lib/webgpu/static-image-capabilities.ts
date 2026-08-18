import type { PreviewLayer } from '../../shared/types'
import { isWebGpuAvailable } from './runtime'

function hasUnsupportedLayerData(layer: PreviewLayer): boolean {
  const isMediaLayer = (layer.layerType ?? 'media') === 'media'
  const isLocalColorInput = layer.layerType === 'local-color' && layer.precomposeRole === 'input'
  const isLocalColorOutput = layer.layerType === 'local-color'
    && layer.precomposeRole === 'output'
    && Boolean(layer.precomposeGroup)
  const isPixelStretchLayer = layer.layerType === 'pixel-stretch' && Boolean(layer.pixelStretch)
  const isPixelFlowLayer = layer.layerType === 'pixel-flow' && Boolean(layer.pixelFlow)
  const isRasterizableLayer = layer.layerType === 'shape'
    || layer.layerType === 'text'
    || layer.layerType === 'logo'
    || layer.layerType === 'decoration'
  const hasContent = isRasterizableLayer && Boolean(
    layer.layerType === 'shape'
      || layer.filePath
      || typeof layer.content === 'string',
  )
  return (!isMediaLayer
    && !isLocalColorInput
    && !isLocalColorOutput
    && !isPixelStretchLayer
    && !isPixelFlowLayer
    && !(isRasterizableLayer && hasContent))
}

/**
 * Reports whether the current renderer preserves all supported media-layer data.
 * Non-media layers stay on their pre-migration stage until their source pipeline
 * is available in the WebGPU composition renderer.
 */
export function canUseWebGpuStaticImageComposition(layers: PreviewLayer[]): boolean {
  return isWebGpuAvailable()
    && layers.length > 0
    && layers.every((layer) => (
      !layer.isVideo
      && !hasUnsupportedLayerData(layer)
    ))
}

export function canUseWebGpuVideoComposition(layers: PreviewLayer[]): boolean {
  return isWebGpuAvailable()
    && layers.length > 0
    && layers.every((layer) => !hasUnsupportedLayerData(layer))
}

function canUseWebGpuVideoExportLayer(layer: PreviewLayer): boolean {
  const layerType = layer.layerType ?? 'media'
  if (layerType === 'media'
    || layerType === 'pixel-flow' && Boolean(layer.pixelFlow)
    || layerType === 'pixel-stretch' && Boolean(layer.pixelStretch)
    || layerType === 'local-color' && Boolean(layer.precomposeRole && layer.precomposeGroup)) return true
  if (layerType === 'shape') return true
  if (layerType === 'text') return typeof layer.content === 'string'
  return (layerType === 'logo' || layerType === 'decoration')
    && (Boolean(layer.filePath) || typeof layer.content === 'string')
}

/**
 * Worker-safe video export capability. Text and shape layers are rasterized
 * with OffscreenCanvas in the export worker; font bytes are sent with the job
 * so custom subtitle fonts do not depend on the renderer document.
 */
export function canUseWebGpuVideoExportComposition(layers: PreviewLayer[]): boolean {
  return isWebGpuAvailable()
    && layers.length > 0
    && layers.every((layer) => !hasUnsupportedLayerData(layer) && canUseWebGpuVideoExportLayer(layer))
}
