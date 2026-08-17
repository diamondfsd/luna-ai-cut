import type { CompositionInput } from '../../shared/types'
import { filePathToPreviewUrl } from '../fileUtils'
import { WebGpuCompositionRenderer } from './composition'
import { readWebGpuLut } from './lut-source'

export type WebGpuImageExportFormat = 'jpeg' | 'png' | 'webp'

function loadImage(path: string): Promise<HTMLImageElement> {
  const url = filePathToPreviewUrl(path) ?? path
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`图片加载失败: ${path}`))
    image.src = url
  })
}

/**
 * 用与静态预览相同的 WebGPU composition renderer 生成图片 Blob。
 * 文件保存由调用方负责，以便复用现有导出目录和任务协议。
 */
export async function renderStaticImageCompositionToBlob(params: {
  composition: CompositionInput
  format: WebGpuImageExportFormat
  quality: number
}): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const renderer = new WebGpuCompositionRenderer(canvas)
  const imageCache = new Map<string, HTMLImageElement>()

  try {
    await renderer.initialize({
      resolveImage: async (path) => {
        const cached = imageCache.get(path)
        if (cached) return cached
        const image = await loadImage(path)
        imageCache.set(path, image)
        return image
      },
      resolveLut: readWebGpuLut,
    })
    await renderer.render(params.composition)
    return await renderer.toBlob(params.format, params.quality)
  } finally {
    renderer.destroy()
    imageCache.clear()
  }
}
