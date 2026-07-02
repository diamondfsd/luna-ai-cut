import { useEffect, useState } from 'react'
import { WatermarkOverlay } from '../../components/WatermarkOverlay'
import { calculateWatermarkLayout, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../../shared/watermark'
import { loadWatermarkImage } from '../../shared/watermarkAssets'
import type { WatermarkImageInfo } from '../../shared/watermarkAssets'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'

export function WorkspaceWatermarkOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()

  const { settings } = edit.previewPipeline.watermark
    ? { settings: edit.previewPipeline.watermark }
    : { settings: edit.pipeline.watermark }
  const { imageRect } = canvas

  const [wmImage, setWmImage] = useState<WatermarkImageInfo | null>(null)

  useEffect(() => {
    if (!settings.enabled) {
      setWmImage(null)
      return
    }
    let cancelled = false
    loadWatermarkImage(settings.style, 'image').then((info) => {
      if (!cancelled) setWmImage(info)
    })
    return () => { cancelled = true }
  }, [settings.enabled, settings.style])

  if (!settings.enabled || imageRect.width <= 1 || imageRect.height <= 1 || !wmImage) return null
  const layout = calculateWatermarkLayout({
    contentWidth: imageRect.width,
    contentHeight: imageRect.height,
    watermarkWidth: wmImage.width,
    watermarkHeight: wmImage.height,
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
