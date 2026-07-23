interface ThumbnailReadyEvent {
  fileId: string
  fileName?: string
  downloadName?: string
  cacheFilePath: string
  thumbnailUrl: string
}

type ThumbnailReadyListener = (event: ThumbnailReadyEvent) => void

const listeners = new Set<ThumbnailReadyListener>()
const latestByFileId = new Map<string, ThumbnailReadyEvent>()
let unsubscribeIpc: (() => void) | null = null

export function latestThumbnailReady(fileId: string): ThumbnailReadyEvent | null {
  return latestByFileId.get(fileId) ?? null
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
