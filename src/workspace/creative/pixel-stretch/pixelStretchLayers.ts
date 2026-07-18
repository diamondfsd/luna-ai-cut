import type { PreviewLayer } from '../../../shared/types'
import type { PixelStretchPresetId } from '../../../shared/types/workspace'

interface PixelStretchLayerOptions {
  layers: PreviewLayer[]
  maskPath: string
  preset: PixelStretchPresetId
  intensity: number
}

function stripCount(intensity: number): number {
  return Math.round(10 + intensity * 0.18)
}

function horizontalStrips(source: PreviewLayer, count: number, window: number): PreviewLayer[] {
  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 0.5) / count
    return {
      ...source,
      fit: 'stretch' as const,
      srcX: Math.max(0, Math.min(1 - window, progress - window / 2)),
      srcY: Math.max(0, Math.min(0.92, 0.5 + (progress - 0.5) * 0.16)),
      srcW: window,
      srcH: 0.08,
      dstX: 0,
      dstY: index / count,
      dstW: 1,
      dstH: 1 / count + 0.002,
      zIndex: -20 + index / 1000,
    }
  })
}

function verticalStrips(source: PreviewLayer, count: number, window: number): PreviewLayer[] {
  return Array.from({ length: count }, (_, index) => {
    const progress = (index + 0.5) / count
    return {
      ...source,
      fit: 'stretch' as const,
      srcX: Math.max(0, Math.min(0.92, 0.5 + (progress - 0.5) * 0.16)),
      srcY: Math.max(0, Math.min(1 - window, progress - window / 2)),
      srcW: 0.08,
      srcH: window,
      dstX: index / count,
      dstY: 0,
      dstW: 1 / count + 0.002,
      dstH: 1,
      zIndex: -20 + index / 1000,
    }
  })
}

/** 背景由采样窄条延展组成，主体则使用同一张原图与模型蒙版还原。 */
export function buildPixelStretchLayers(options: PixelStretchLayerOptions): PreviewLayer[] {
  const main = options.layers[0]
  if (!main) return []
  const count = stripCount(options.intensity)
  const window = Math.max(0.004, 0.07 - options.intensity * 0.00055)
  const background = options.preset === 'horizon'
    ? horizontalStrips(main, count, window)
    : options.preset === 'vertical'
      ? verticalStrips(main, count, window)
      : [
          ...horizontalStrips(main, Math.ceil(count / 2), window),
          ...verticalStrips(main, Math.floor(count / 2), window),
        ]
  const subject: PreviewLayer = {
    ...main,
    fit: 'cover',
    maskPath: options.maskPath,
    maskOpacity: 1,
    maskInverted: false,
    maskFeather: 1,
    zIndex: 10,
  }
  return [...background, subject, ...options.layers.slice(1)]
}
