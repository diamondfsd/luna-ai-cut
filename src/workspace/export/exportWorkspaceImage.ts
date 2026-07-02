import type { WatermarkSettings } from '../../shared/types'
import { calculateWatermarkLayout, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../../shared/watermark'
import { loadWatermarkImage } from '../../shared/watermarkAssets'

interface ImageRect {
  x: number
  y: number
  width: number
  height: number
}

export async function composeWorkspaceExport(canvas: HTMLCanvasElement, imageRect: ImageRect, watermark: WatermarkSettings): Promise<string> {
  const scaleX = canvas.width / Math.max(1, canvas.clientWidth)
  const scaleY = canvas.height / Math.max(1, canvas.clientHeight)
  const outputWidth = Math.max(1, Math.round(imageRect.width * scaleX))
  const outputHeight = Math.max(1, Math.round(imageRect.height * scaleY))
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = outputWidth
  exportCanvas.height = outputHeight
  const context = exportCanvas.getContext('2d')
  if (!context) throw new Error('当前设备无法导出图片')
  context.drawImage(
    canvas,
    Math.round(imageRect.x * scaleX),
    Math.round(imageRect.y * scaleY),
    outputWidth,
    outputHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  )

  if (watermark.enabled) {
    const wmInfo = await loadWatermarkImage(watermark.style, 'image')
    const layout = calculateWatermarkLayout({
      contentWidth: outputWidth,
      contentHeight: outputHeight,
      watermarkWidth: wmInfo.width,
      watermarkHeight: wmInfo.height,
      widthRatio: watermark.watermarkPercent / 100,
      marginXRatio: WATERMARK_MARGIN_X_RATIO,
      marginYRatio: WATERMARK_MARGIN_Y_RATIO,
      position: watermark.position,
    })
    const image = new Image()
    image.src = wmInfo.src
    await image.decode()
    context.globalAlpha = 0.85
    context.drawImage(image, layout.x, layout.y, layout.width, layout.height)
    context.globalAlpha = 1
  }

  return exportCanvas.toDataURL('image/png')
}
