interface ThumbnailReadyEvent {
  fileId: string
  fileName?: string
  downloadName?: string
  cacheFilePath: string | null
  thumbnailUrl: string | null
}

type ThumbnailReadyListener = (event: ThumbnailReadyEvent) => void

const listeners = new Set<ThumbnailReadyListener>()
const latestByFileId = new Map<string, ThumbnailReadyEvent>()
let unsubscribeIpc: (() => void) | null = null

export function latestThumbnailReady(fileId: string): ThumbnailReadyEvent | null {
  return latestByFileId.get(fileId) ?? null
}

/**
 * 丢弃渲染进程中记住的缩略图地址。
 *
 * 磁盘缓存可能由设置页或系统工具清除；如果继续复用旧地址，图片加载失败后的
 * 重试会再次命中同一个失效记录，无法等待主进程重新生成。
 */
export function invalidateThumbnailReady(fileId?: string): void {
  if (fileId) {
    latestByFileId.delete(fileId)
    return
  }
  latestByFileId.clear()
}

export function subscribeThumbnailReady(listener: ThumbnailReadyListener): () => void {
  listeners.add(listener)
  if (!unsubscribeIpc) {
    unsubscribeIpc = window.luna.onThumbnailReady((event) => {
      latestByFileId.set(event.fileId, event)
      for (const current of listeners) current(event)
    })
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unsubscribeIpc?.()
      unsubscribeIpc = null
    }
  }
}
