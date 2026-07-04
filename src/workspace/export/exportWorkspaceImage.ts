export async function composeWorkspaceExport(
  canvas: HTMLCanvasElement,
  imageRect: { x: number; y: number; width: number; height: number },
  /** 可选的 WebGL 全分辨率渲染 Blob，有则直接解码使用，无则从 canvas 截取 */
  fullResBlob?: Blob,
): Promise<string> {
  let imageData: ImageBitmap | HTMLCanvasElement

  if (fullResBlob) {
    // WebGL 全分辨率导出：直接从 Blob 解码
    imageData = await createImageBitmap(fullResBlob)
  } else {
    // 兼容旧路径：从预览 canvas 截取
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
      outputWidth, outputHeight,
      0, 0, outputWidth, outputHeight,
    )
    imageData = exportCanvas
  }

  const width = imageData instanceof ImageBitmap ? imageData.width : imageData.width
  const height = imageData instanceof ImageBitmap ? imageData.height : imageData.height

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = width
  exportCanvas.height = height
  const context = exportCanvas.getContext('2d')
  if (!context) throw new Error('当前设备无法导出图片')
  context.drawImage(imageData, 0, 0)

  if (imageData instanceof ImageBitmap) imageData.close()

  // 水印渲染已移除，由 Native Core 后端完成

  return exportCanvas.toDataURL('image/png')
}
