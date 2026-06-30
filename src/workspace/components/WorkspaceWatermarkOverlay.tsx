import { WatermarkOverlay } from '../../components/WatermarkOverlay'
import type { WatermarkSettings, WatermarkStyle } from '../../shared/types'
import { calculateWatermarkLayout, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../../shared/watermark'

interface WorkspaceWatermarkOverlayProps {
  settings: WatermarkSettings
  imageRect: { x: number; y: number; width: number; height: number }
}

const WATERMARK_IMAGE_SIZE: Record<WatermarkStyle, { width: number; height: number }> = {
  luna_ultra: { width: 1399, height: 252 },
  luna_ultra_cn: { width: 1605, height: 252 },
}

export function WorkspaceWatermarkOverlay({ settings, imageRect }: WorkspaceWatermarkOverlayProps) {
  if (!settings.enabled || imageRect.width <= 1 || imageRect.height <= 1) return null
  const watermarkSize = WATERMARK_IMAGE_SIZE[settings.style] ?? WATERMARK_IMAGE_SIZE.luna_ultra_cn
  const layout = calculateWatermarkLayout({
    contentWidth: imageRect.width,
    contentHeight: imageRect.height,
    watermarkWidth: watermarkSize.width,
    watermarkHeight: watermarkSize.height,
    widthRatio: settings.watermarkPercent / 100,
    marginXRatio: WATERMARK_MARGIN_X_RATIO,
    marginYRatio: WATERMARK_MARGIN_Y_RATIO,
    position: settings.position,
  })

  return (
    <WatermarkOverlay
      settings={settings}
      kind="image"
      x={imageRect.x + layout.x}
      y={imageRect.y + layout.y}
      width={layout.width}
      height={layout.height}
      className="workspace-watermark-overlay"
    />
  )
}
