import type { PreviewLayer } from '../../shared/types'
import { isWebGpuAvailable } from './runtime'

function hasUnsupportedColor(color: PreviewLayer['color']): boolean {
  if (!color) return false

  const unsupportedNumericValues = [
    color.black,
    color.clarity,
    color.texture,
    color.sharpen,
    color.denoise,
    color.skinSmoothing,
    color.glowStrength,
    color.gradeShadowsAmount,
    color.gradeMidAmount,
    color.gradeHighlightsAmount,
    color.curveLift,
    color.curveContrast,
    color.levelsBlack,
    color.levelsGray - 0.5,
    color.levelsWhite - 1,
  ]
  if (unsupportedNumericValues.some((value) => Math.abs(value ?? 0) > 0.0001)) return true

  if (color.hslChannels?.some((channel) => (
    Math.abs(channel.hueShift) > 0.0001
    || Math.abs(channel.saturation) > 0.0001
    || Math.abs(channel.luminance) > 0.0001
  ))) return true

  return Boolean(color.curve && Object.values(color.curve).some((points) => points.length > 0))
}

function hasUnsupportedLayerData(layer: PreviewLayer): boolean {
  return (layer.layerType ?? 'media') !== 'media'
    || Boolean(layer.maskPath)
    || Boolean(layer.maskProjectId)
    || Boolean(layer.maskTimeline)
    || Boolean(layer.pixelStretch)
    || Boolean(layer.pixelFlow)
    || Boolean(layer.reveal)
    || Boolean(layer.positioning)
    || Boolean(layer.transform?.crop)
    || Math.abs(layer.transform?.translateX ?? 0) > 0.0001
    || Math.abs(layer.transform?.translateY ?? 0) > 0.0001
    || hasUnsupportedColor(layer.color)
}

/**
 * Reports whether the current first-pass renderer preserves all layer data.
 * Unsupported structures stay on their pre-migration stage until implemented.
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
