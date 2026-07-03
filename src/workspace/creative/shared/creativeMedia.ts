import { filePathToPreviewUrl } from '../../../components/previewModalUtils'
import type { WorkspaceMediaAsset } from '../../../shared/types'
import { exportImageWithWebGL } from '../../export/exportImageWithWebGL'
import { createDefaultPipeline, mergePipeline, type EditPipeline, type PipelinePatch } from '../../shared/editPipeline'

export interface CreativeSlotSource {
  asset: WorkspaceMediaAsset
  pipeline: EditPipeline
}

export interface CreativeSlotTransform {
  scale: number
  offsetX: number
  offsetY: number
}

export function normalizeCreativePipeline(value: unknown): EditPipeline {
  if (!value || typeof value !== 'object') return createDefaultPipeline()
  return mergePipeline(createDefaultPipeline(), value as PipelinePatch)
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
  let width = 0
  let height = 0
  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth
    height = source.videoHeight
  } else if (source instanceof HTMLImageElement) {
    width = source.naturalWidth
    height = source.naturalHeight
  } else if (source instanceof HTMLCanvasElement || source instanceof ImageBitmap) {
    width = source.width
    height = source.height
  }
  if (!width || !height) return
  const scale = Math.max(area.width / width, area.height / height)
  const userScale = transform?.scale ?? 1
  const drawWidth = width * scale * userScale
  const drawHeight = height * scale * userScale
  const offsetX = transform?.offsetX ?? 0
  const offsetY = transform?.offsetY ?? 0
  ctx.drawImage(source, area.x + (area.width - drawWidth) / 2 + offsetX, area.y + (area.height - drawHeight) / 2 + offsetY, drawWidth, drawHeight)
}

export async function loadCreativeImageSource(asset: WorkspaceMediaAsset, pipeline: EditPipeline): Promise<HTMLImageElement> {
  let src = assetPreviewUrl(asset)
  if (asset.kind === 'image') {
    try {
      const blob = await exportImageWithWebGL(asset.path, pipeline)
      src = URL.createObjectURL(blob)
    } catch {
      src = assetPreviewUrl(asset)
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`无法加载「${asset.name}」`))
    img.src = src
  })
}

export async function loadCreativePreviewImageSource(asset: WorkspaceMediaAsset): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`无法加载「${asset.name}」`))
    img.src = assetPreviewUrl(asset)
  })
}

export async function loadCreativeVideoSource(asset: WorkspaceMediaAsset): Promise<HTMLVideoElement> {
  let sourceUrl = assetSourceUrl(asset)
  if (asset.isLivePhoto) {
    const result = await window.luna.previewLivePhoto({
      id: asset.id,
      name: asset.name,
      href: asset.name,
      sourceUrl,
      url: sourceUrl,
      dateText: '',
      timeText: '',
      sizeText: '',
      bytes: null,
      kind: 'image',
      extension: '',
      capturedAt: null,
      groupDay: '',
      groupHour: '',
      videoKey: null,
      previewName: null,
      previewUrl: null,
      cacheFilePath: null,
      downloadFilePath: asset.path,
      thumbnailUrl: asset.thumbnailUrl ?? null,
      isLivePhoto: true,
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: asset.name,
      canPreview: true,
      localPath: asset.path,
    })
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
