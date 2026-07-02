export interface ImageCacheEntry {
  originalPath: string
  previewBitmap: ImageBitmap
  thumbnailUrl: string
  width: number
  height: number
}

const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.mts', '.insv', '.lrv']

function isVideoPath(filePath: string): boolean {
  const ext = filePath.toLowerCase().split('.').pop()
  return ext ? VIDEO_EXTS.includes(`.${ext}`) : false
}

function drawThumbnail(bitmap: ImageBitmap, maxSize: number): string {
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  context?.drawImage(bitmap, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

/**
 * 用隐藏 <video> 截取视频某帧，返回 ImageBitmap
 */
async function extractVideoFrame(filePath: string): Promise<ImageBitmap> {
  return new Promise<ImageBitmap>((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'

    const timeout = setTimeout(() => {
      video.remove()
      reject(new Error('视频帧提取超时'))
    }, 15000)

    video.addEventListener('loadeddata', () => {
      // 快进到第一秒，截取一个非全黑帧
      video.currentTime = Math.min(1, video.duration / 2)
    })

    video.addEventListener('seeked', () => {
      clearTimeout(timeout)
      try {
        const bitmap = createImageBitmap(video)
        video.remove()
        resolve(bitmap)
      } catch (e) {
        video.remove()
        reject(e)
      }
    })

    video.addEventListener('error', () => {
      clearTimeout(timeout)
      video.remove()
      reject(new Error('视频加载失败'))
    })

    // 用 file:// 协议加载本地视频
    const normalized = filePath.replace(/\\/g, '/')
    video.src = encodeURI(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`)
      .replace(/#/g, '%23').replace(/\?/g, '%3F')
  })
}

export class ImageCache {
  private entries = new Map<string, ImageCacheEntry>()

  async generate(filePath: string): Promise<ImageCacheEntry> {
    const existing = this.entries.get(filePath)
    if (existing) return existing

    // 视频文件：用 <video> 元素截取一帧
    if (isVideoPath(filePath)) {
      const bitmap = await extractVideoFrame(filePath)
      const thumbnailUrl = drawThumbnail(bitmap, 260)
      const entry: ImageCacheEntry = {
        originalPath: filePath,
        previewBitmap: bitmap,
        thumbnailUrl,
        width: bitmap.width,
        height: bitmap.height,
      }
      this.entries.set(filePath, entry)
      return entry
    }

    // 图片文件：走后端 service（带缩放宽高自适应）
    const preview = await window.luna.workspace.loadPreview(filePath)
    const blob = new Blob([preview.buffer], { type: preview.mimeType })
    const bitmap = await createImageBitmap(blob)
    const thumbnailUrl = drawThumbnail(bitmap, 260)
    const entry: ImageCacheEntry = {
      originalPath: filePath,
      previewBitmap: bitmap,
      thumbnailUrl,
      width: bitmap.width,
      height: bitmap.height,
    }
    this.entries.set(filePath, entry)
    return entry
  }

  clear(filePath?: string): void {
    if (filePath) {
      this.entries.get(filePath)?.previewBitmap.close()
      this.entries.delete(filePath)
      return
    }

    for (const entry of this.entries.values()) {
      entry.previewBitmap.close()
    }
    this.entries.clear()
  }
}

export const workspaceImageCache = new ImageCache()
