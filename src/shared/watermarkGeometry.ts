import type { WatermarkPlacement, WatermarkPosition, WatermarkPositioning, WatermarkSettings } from './types'

export const DEFAULT_WATERMARK_WIDTH_RATIO = 0.23
export const DEFAULT_WATERMARK_INSET_ON_SHORT_EDGE = 0.059
export const MIN_WATERMARK_WIDTH_RATIO = 0.08
export const MAX_WATERMARK_WIDTH_RATIO = 0.8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function defaultWatermarkPlacement(position: WatermarkPosition = 'bottom-center'): WatermarkPlacement {
  return {
    mode: 'preset',
    anchor: position,
    insetOnShortEdge: DEFAULT_WATERMARK_INSET_ON_SHORT_EDGE,
  }
}

export function effectiveWatermarkPlacement(settings: WatermarkSettings): WatermarkPlacement {
  return settings.placement ?? defaultWatermarkPlacement(settings.position)
}

export function usesCustomWatermark(settings: WatermarkSettings | null | undefined): boolean {
  return settings?.sourceKind === 'custom' && Boolean(settings.customAsset?.filePath)
}

export function watermarkImagePath(settings: WatermarkSettings): string | undefined {
  return usesCustomWatermark(settings) ? settings.customAsset?.filePath : settings.imagePath
}

function topLeftForPreset(
  anchor: WatermarkPosition,
  width: number,
  height: number,
  insetX: number,
  insetY: number,
): { x: number; y: number } {
  const left = insetX
  const centerX = (1 - width) / 2
  const right = 1 - width - insetX
  const top = insetY
  const bottom = 1 - height - insetY

  switch (anchor) {
    case 'top-left': return { x: left, y: top }
    case 'top-center': return { x: centerX, y: top }
    case 'top-right': return { x: right, y: top }
    case 'bottom-left': return { x: left, y: bottom }
    case 'bottom-right': return { x: right, y: bottom }
    default: return { x: centerX, y: bottom }
  }
}

export function resolveWatermarkPositioning(
  settings: WatermarkSettings,
  canvasWidth: number,
  canvasHeight: number,
): WatermarkPositioning {
  const safeCanvasWidth = Math.max(1, canvasWidth)
  const safeCanvasHeight = Math.max(1, canvasHeight)
  const shortEdge = Math.min(safeCanvasWidth, safeCanvasHeight)
  const imageWidth = Math.max(1, finiteOr(settings.imageWidth ?? settings.customAsset?.width, 4))
  const imageHeight = Math.max(1, finiteOr(settings.imageHeight ?? settings.customAsset?.height, 1))
  const imageAspect = imageWidth / imageHeight
  const requestedWidth = clamp(
    finiteOr(settings.sizeOnCanvasWidth, DEFAULT_WATERMARK_WIDTH_RATIO),
    MIN_WATERMARK_WIDTH_RATIO,
    MAX_WATERMARK_WIDTH_RATIO,
  )
  const maxWidthForHeight = 0.96 * safeCanvasHeight * imageAspect / safeCanvasWidth
  const targetWidth = Math.min(requestedWidth, 0.96, maxWidthForHeight)
  const targetHeight = targetWidth * safeCanvasWidth / safeCanvasHeight / imageAspect
  const placement = effectiveWatermarkPlacement(settings)

  let x: number
  let y: number
  if (placement.mode === 'free') {
    x = finiteOr(placement.centerX, 0.5) - targetWidth / 2
    y = finiteOr(placement.centerY, 0.5) - targetHeight / 2
  } else {
    const inset = clamp(finiteOr(placement.insetOnShortEdge, DEFAULT_WATERMARK_INSET_ON_SHORT_EDGE), 0, 0.25)
    const preset = topLeftForPreset(
      placement.anchor,
      targetWidth,
      targetHeight,
      inset * shortEdge / safeCanvasWidth,
      inset * shortEdge / safeCanvasHeight,
    )
    x = preset.x
    y = preset.y
  }

  return {
    anchor: 'top-left',
    targetWidth,
    marginX: clamp(x, 0, Math.max(0, 1 - targetWidth)),
    marginY: clamp(y, 0, Math.max(0, 1 - targetHeight)),
  }
}

export function freePlacementFromTopLeft(
  positioning: WatermarkPositioning,
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
): WatermarkPlacement {
  const canvasAspect = Math.max(1, canvasWidth) / Math.max(1, canvasHeight)
  const imageAspect = Math.max(1, imageWidth) / Math.max(1, imageHeight)
  const height = positioning.targetWidth * canvasAspect / imageAspect
  const marginX = positioning.marginX ?? 0
  const marginY = positioning.marginY ?? 0
  let x = marginX
  let y = marginY
  switch (positioning.anchor) {
    case 'top-center': x = (1 - positioning.targetWidth) / 2; break
    case 'top-right': x = 1 - positioning.targetWidth - marginX; break
    case 'bottom-left': y = 1 - height - marginY; break
    case 'bottom-center': x = (1 - positioning.targetWidth) / 2; y = 1 - height - marginY; break
    case 'bottom-right': x = 1 - positioning.targetWidth - marginX; y = 1 - height - marginY; break
    default: break
  }
  return {
    mode: 'free',
    centerX: clamp(x + positioning.targetWidth / 2, 0, 1),
    centerY: clamp(y + height / 2, 0, 1),
  }
}
