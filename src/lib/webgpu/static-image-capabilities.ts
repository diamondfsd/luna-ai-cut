import type { PreviewLayer } from '../../shared/types'
import { isWebGpuAvailable } from './runtime'

function hasUnsupportedLayerData(layer: PreviewLayer): boolean {
  const isMediaLayer = (layer.layerType ?? 'media') === 'media'
  const isLocalColorInput = layer.layerType === 'local-color' && layer.precomposeRole === 'input'
  const isRasterizableLayer = layer.layerType === 'shape'
    || layer.layerType === 'text'
    || layer.layerType === 'logo'
    || layer.layerType === 'decoration'
  const hasContent = isRasterizableLayer && Boolean(
    layer.layerType === 'shape'
      || layer.filePath
      || typeof layer.content === 'string',
  )
  return (!isMediaLayer && !isLocalColorInput && !(isRasterizableLayer && hasContent))
    || Boolean(layer.pixelStretch)
    || Boolean(layer.pixelFlow)
    || Boolean(layer.transform?.crop)
    || Math.abs(layer.transform?.translateX ?? 0) > 0.0001
    || Math.abs(layer.transform?.translateY ?? 0) > 0.0001
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
    && layers.some((layer) => layer.isVideo)
    && layers.every((layer) => !hasUnsupportedLayerData(layer))
}

export function canUseWebGpuSingleVideoComposition(layers: PreviewLayer[]): boolean {
  return canUseWebGpuVideoComposition(layers)
    && layers.length === 1
    && layers[0]?.isVideo === true
}
