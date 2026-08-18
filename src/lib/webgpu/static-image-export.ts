import type { CompositionInput } from '../../shared/types'
import { filePathToPreviewUrl, isVideoPath } from '../fileUtils'
import { WebGpuCompositionRenderer } from './composition'
import { readWebGpuLut } from './lut-source'
import { loadWebGpuMask } from './mask-source'

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

function loadVideo(path: string): Promise<HTMLVideoElement> {
  const url = filePathToPreviewUrl(path) ?? path
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error(`视频加载失败: ${path}`))
    video.src = url
    video.load()
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('无法读取 WebGPU 缩略图'))
    reader.readAsDataURL(blob)
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
  const videoCache = new Map<string, HTMLVideoElement>()

  try {
    await renderer.initialize({
      resolveImage: async (path) => {
        const cached = imageCache.get(path)
        if (cached) return cached
        const image = await loadImage(path)
        imageCache.set(path, image)
        return image
      },
      resolveSource: async (layer) => {
        if (layer.source.sourceType !== 'video' || !layer.source.key) {
          throw new Error(`WebGPU 缩略图源不是视频: ${layer.source.path}`)
        }
        const cached = videoCache.get(layer.source.key)
        if (cached) return cached
        const video = await loadVideo(layer.source.path)
        videoCache.set(layer.source.key, video)
        return video
      },
      resolveLut: readWebGpuLut,
      resolveMask: loadWebGpuMask,
    })
    await renderer.render(params.composition)
    return await renderer.toBlob(params.format, params.quality)
  } finally {
    renderer.destroy()
    imageCache.clear()
    for (const video of videoCache.values()) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    videoCache.clear()
  }
}

/** Render a composition into a data URL for UI thumbnails. */
export async function renderWebGpuCompositionToDataUrl(params: {
  composition: CompositionInput
  quality?: number
}): Promise<string> {
  const blob = await renderStaticImageCompositionToBlob({
    composition: params.composition,
    format: 'jpeg',
    quality: params.quality ?? 85,
  })
  return blobToDataUrl(blob)
}

/** Mark manually assembled media layers with the source type expected by WebGPU. */
export function compositionSourceType(path: string): 'image' | 'video' {
  return isVideoPath(path) ? 'video' : 'image'
}
