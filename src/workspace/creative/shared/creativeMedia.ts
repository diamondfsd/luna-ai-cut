import { filePathToPreviewUrl } from '../../../lib/fileUtils'
import type { WorkspaceMediaAsset } from '../../../shared/types'
import { createDefaultPipeline, mergePipeline, normalizePersistedPipelinePatch, type EditPipeline } from '../../shared/editPipeline'

export interface CreativeSlotSource {
  asset: WorkspaceMediaAsset
  pipeline: EditPipeline
}

export interface CreativeSlotTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export type CreativePreviewSource = HTMLImageElement | HTMLVideoElement

export function normalizeCreativePipeline(value: unknown): EditPipeline {
  return mergePipeline(createDefaultPipeline(), normalizePersistedPipelinePatch(value).patch)
}

export function assetPreviewUrl(asset: WorkspaceMediaAsset): string {
  return asset.thumbnailUrl || filePathToPreviewUrl(asset.path) || `file://${asset.path}`
}

export function assetSourceUrl(asset: WorkspaceMediaAsset): string {
  return filePathToPreviewUrl(asset.path) || `file://${asset.path}`
}

export function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  area: { x: number; y: number; width: number; height: number },
  transform?: CreativeSlotTransform,
): void {
  let w = 0
  let h = 0
  if (source instanceof HTMLVideoElement) {
    w = source.videoWidth
    h = source.videoHeight
  } else if (source instanceof HTMLImageElement) {
    w = source.naturalWidth
    h = source.naturalHeight
  } else if (source instanceof HTMLCanvasElement || source instanceof ImageBitmap) {
    w = source.width
    h = source.height
  }
  if (!w || !h) return
  const scale = Math.max(area.width / w, area.height / h)
  const userScale = transform?.scale ?? 1
  const drawW = w * scale * userScale
  const drawH = h * scale * userScale
  const ox = transform?.offsetX ?? 0
  const oy = transform?.offsetY ?? 0
  ctx.drawImage(source, 0, 0, w, h, area.x + (area.width - drawW) / 2 + ox, area.y + (area.height - drawH) / 2 + oy, drawW, drawH)
}

export async function loadCreativeImageSource(asset: WorkspaceMediaAsset): Promise<HTMLImageElement> {
  return loadCreativePreviewImageSource(asset)
}

export async function loadCreativePreviewImageSource(asset: WorkspaceMediaAsset): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`无法加载「${asset.name}」`))
    img.src = assetPreviewUrl(asset)
  })
}

export async function loadCreativeImageAspect(asset: WorkspaceMediaAsset): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const aspect = img.naturalWidth / img.naturalHeight
      resolve(Number.isFinite(aspect) && aspect > 0 ? aspect : null)
    }
    img.onerror = () => resolve(null)
    img.src = assetSourceUrl(asset)
  })
}

export async function loadCreativeImageSize(asset: WorkspaceMediaAsset): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth
      const height = img.naturalHeight
      if (width > 0 && height > 0) resolve({ width, height })
      else reject(new Error(`无法读取「${asset.name}」的尺寸`))
    }
    img.onerror = () => reject(new Error(`无法加载「${asset.name}」`))
    img.src = assetSourceUrl(asset)
  })
}

export async function loadCreativeVideoSource(asset: WorkspaceMediaAsset): Promise<HTMLVideoElement> {
  let sourceUrl = assetSourceUrl(asset)
  if (asset.isLivePhoto) {
    const result = await window.luna.previewLivePhoto(sourceUrl)
    if (result.source) sourceUrl = result.source
  }

  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.loop = true
    video.playsInline = true
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error(`无法加载「${asset.name}」`))
    video.src = sourceUrl
  })
}
