import type { CSSProperties } from 'react'

import type { PreviewLayer, WatermarkPositioning } from '../shared/types'

export interface PreviewSize {
  width: number
  height: number
}

export function containPreviewSize(container: PreviewSize, media: PreviewSize): PreviewSize {
  if (container.width <= 0 || container.height <= 0 || media.width <= 0 || media.height <= 0) {
    return { width: 0, height: 0 }
  }
  const scale = Math.min(container.width / media.width, container.height / media.height)
  return { width: media.width * scale, height: media.height * scale }
}

function isDirectionalPositioning(
  positioning: PreviewLayer['positioning'],
): positioning is { landscape?: WatermarkPositioning; portrait?: WatermarkPositioning } {
  return Boolean(positioning && !('anchor' in positioning))
}

export function resolveWatermarkPositioning(
  layer: PreviewLayer,
  media: PreviewSize,
): WatermarkPositioning | null {
  const positioning = layer.positioning
  if (!positioning) return null
  if (!isDirectionalPositioning(positioning)) return positioning
  return media.width >= media.height
    ? positioning.landscape ?? positioning.portrait ?? null
    : positioning.portrait ?? positioning.landscape ?? null
}

export function watermarkPositionStyle(positioning: WatermarkPositioning): CSSProperties {
  const marginX = `${(positioning.marginX ?? 0) * 100}%`
  const marginY = `${(positioning.marginY ?? 0) * 100}%`
  const style: CSSProperties = { width: `${positioning.targetWidth * 100}%` }
  if (positioning.anchor.includes('left')) style.left = marginX
  if (positioning.anchor.includes('right')) style.right = marginX
  if (positioning.anchor.includes('top')) style.top = marginY
  if (positioning.anchor.includes('bottom')) style.bottom = marginY
  if (positioning.anchor === 'center') {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
  } else if (positioning.anchor === 'top-center') {
    style.left = '50%'
    style.top = marginY
    style.transform = 'translateX(-50%)'
  } else if (positioning.anchor === 'bottom-center') {
    style.left = '50%'
    style.bottom = marginY
    style.transform = 'translateX(-50%)'
  }
  return style
}
