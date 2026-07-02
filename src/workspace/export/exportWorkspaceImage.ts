import type { WatermarkSettings } from '../../shared/types'
import { resolveWatermarkRatios } from '../../shared/watermark/layoutConfig'
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
    const ratios = resolveWatermarkRatios(null, watermark.style, outputWidth, outputHeight, watermark.position)
    const widthRatio = ratios?.widthRatio ?? 0.15

    const sensorW = Math.max(outputWidth, outputHeight)
    const wmAspect = wmInfo.height / wmInfo.width
    const targetW = Math.min(Math.round(sensorW * widthRatio), wmInfo.width)
    const targetH = Math.round(targetW * wmAspect)

    const [vPos, hPos] = watermark.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
    const marginX = Math.round(outputWidth * 0.03)
    const marginY = Math.round(outputHeight * 0.03)
    const x = hPos === 'left' ? marginX
      : hPos === 'right' ? outputWidth - targetW - marginX
      : Math.round((outputWidth - targetW) / 2)
    const y = vPos === 'bottom' ? outputHeight - targetH - marginY : marginY

    const image = new Image()
    image.src = wmInfo.src
    await image.decode()
    context.globalAlpha = 0.85
    context.drawImage(image, x, y, targetW, targetH)
    context.globalAlpha = 1
  }

  return exportCanvas.toDataURL('image/png')
}
