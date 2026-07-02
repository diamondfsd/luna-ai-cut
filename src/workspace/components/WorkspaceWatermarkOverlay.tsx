import { useEffect, useState } from 'react'
import { WatermarkOverlay } from '../../components/WatermarkOverlay'
import { resolveWatermarkRatios } from '../../shared/watermark/layoutConfig'
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

  const ratios = resolveWatermarkRatios(null, settings.style, imageRect.width, imageRect.height, settings.position)
  const widthRatio = ratios?.widthRatio ?? 0.15

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

  const sensorW = Math.max(imageRect.width, imageRect.height)
  const wmAspect = wmImage.height / wmImage.width
  const targetW = Math.min(Math.round(sensorW * widthRatio), wmImage.width)
  const targetH = Math.round(targetW * wmAspect)

  const [vPos] = settings.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const xRatio = ratios?.xRatio ?? 0.03
  const yRatio = ratios?.yRatio ?? 0.03
  const x = Math.round(imageRect.width * xRatio)
  const y = vPos === 'bottom'
    ? Math.round(imageRect.height - targetH - imageRect.height * yRatio)
    : Math.round(imageRect.height * (1 - yRatio))

  return (
    <WatermarkOverlay
      settings={settings}
      kind="image"
      x={imageRect.x + x}
      y={imageRect.y + y}
      width={targetW}
      height={targetH}
      className="workspace-watermark-overlay"
    />
  )
}
