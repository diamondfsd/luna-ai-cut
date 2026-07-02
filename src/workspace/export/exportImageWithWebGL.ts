import type { EditPipeline } from '../shared/editPipeline'
import { WebGLRenderer } from '../renderer/webglRenderer'
import { filePathToPreviewUrl } from '../../components/previewModalUtils'

/**
 * 使用 WebGL shader 在原始分辨率下渲染图片并导出为 Blob
 * （和预览完全一致的调色效果，无 ffmpeg 参与）
 */
export async function exportImageWithWebGL(
  sourcePath: string,
  pipeline: EditPipeline,
): Promise<Blob> {
  // 1. 获取原始图片尺寸
  const img = await loadImage(sourcePath)
  const width = img.naturalWidth
  const height = img.naturalHeight

  // 2. 创建离屏 canvas（原始分辨率）
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  // 3. WebGL 渲染
  const renderer = new WebGLRenderer(canvas)
  try {
    const bitmap = await createImageBitmap(img)
    renderer.loadImage(bitmap)
    renderer.resize(width, height)
    renderer.render(pipeline)

    // 4. 导出为 PNG Blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b)
        else reject(new Error('导出图片失败'))
      }, 'image/png')
    })

    bitmap.close()
    return blob
  } finally {
    renderer.destroy()
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`加载图片失败: ${src}`))
    img.src = filePathToPreviewUrl(src) ?? `file://${src}`
  })
}

/** 将 Blob 转为 base64 data URL（用于 IPC 传输到主进程保存） */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Blob 转 data URL 失败'))
    reader.readAsDataURL(blob)
  })
}
