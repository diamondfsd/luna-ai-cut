import type { WatermarkSettings, WatermarkStyle } from '../../shared/types'
import { calculateWatermarkLayout, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../../shared/watermark'
import wmUltraImage from '../../assets/watermark/ic_watermark_luna_ultra_image.png'
import wmUltraImageCn from '../../assets/watermark/ic_watermark_luna_ultra_image_cn.png'

interface ImageRect {
  x: number
  y: number
  width: number
  height: number
}

const WATERMARK_ASSETS: Record<WatermarkStyle, { src: string; width: number; height: number }> = {
  luna_ultra: { src: wmUltraImage, width: 1399, height: 252 },
  luna_ultra_cn: { src: wmUltraImageCn, width: 1605, height: 252 },
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('水印加载失败'))
    image.src = src
  })
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
    const asset = WATERMARK_ASSETS[watermark.style] ?? WATERMARK_ASSETS.luna_ultra_cn
    const layout = calculateWatermarkLayout({
      contentWidth: outputWidth,
      contentHeight: outputHeight,
      watermarkWidth: asset.width,
      watermarkHeight: asset.height,
      widthRatio: watermark.watermarkPercent / 100,
      marginXRatio: WATERMARK_MARGIN_X_RATIO,
      marginYRatio: WATERMARK_MARGIN_Y_RATIO,
      position: watermark.position,
    })
    const image = await loadImage(asset.src)
    context.globalAlpha = 0.85
    context.drawImage(image, layout.x, layout.y, layout.width, layout.height)
    context.globalAlpha = 1
  }

  return exportCanvas.toDataURL('image/png')
}
