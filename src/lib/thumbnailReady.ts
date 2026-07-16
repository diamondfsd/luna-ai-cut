interface ThumbnailReadyEvent {
  fileId: string
  fileName?: string
  downloadName?: string
  cacheFilePath: string
  thumbnailUrl: string
}

type ThumbnailReadyListener = (event: ThumbnailReadyEvent) => void

const listeners = new Set<ThumbnailReadyListener>()
let unsubscribeIpc: (() => void) | null = null

export function subscribeThumbnailReady(listener: ThumbnailReadyListener): () => void {
  listeners.add(listener)
  if (!unsubscribeIpc) {
    unsubscribeIpc = window.luna.onThumbnailReady((event) => {
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
