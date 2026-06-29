export interface ImageCacheEntry {
  originalPath: string
  previewBitmap: ImageBitmap
  thumbnailUrl: string
  width: number
  height: number
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

export class ImageCache {
  private entries = new Map<string, ImageCacheEntry>()

  async generate(filePath: string): Promise<ImageCacheEntry> {
    const existing = this.entries.get(filePath)
    if (existing) return existing

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
