import { compositionRevealProgress } from '../lib/revealProgress'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { PreviewLayer } from '../shared/types'
import { maskTrackTransformAt } from '../workspace/mask/maskTrack'
import { maskTimelineSampleAt } from '../workspace/mask/maskTimeline'
import { compositionTimeForVideoLayer } from './previewLayerTiming'

const DEFAULT_PREVIEW_MAX_SIDE = 1280
const PREVIEW_HARD_MAX_SIDE = 3840

export interface LunaRenderCore {
  init: () => Promise<void>
  getNativePreviewCapabilities?: () => Promise<{
    decoder: string
    systemHardwareDecode: boolean
    externalGpuTexture: boolean
    directGpuPresentation: boolean
  }>
  loadTexture: (data: Buffer, width: number, height: number) => Promise<number>
  updateTexture: (textureId: number, data: Buffer) => Promise<void>
  renderFrame: (canvasWidth: number, canvasHeight: number, layers: unknown[], compositionTime?: number) => Promise<Buffer>
  releaseTexture: (textureId: number) => Promise<void>
}

export interface VideoStateEntry {
  key: string
  video: HTMLVideoElement
  frameCallbackId: number | null
  textureId: number
  offscreen: OffscreenCanvas | null
  renderW: number
  renderH: number
  prevVideoTime: number
  lastUploadedVideoTime: number
  ready: boolean
}

export interface MultipleLayerVideoPreviewLrcRenderProps {
  layers: PreviewLayer[]
  active?: boolean
  className?: string
  canvasWidth?: number
  canvasHeight?: number
  maxSide?: number
  playing?: boolean
  compositionTime?: number
  decodeQuality?: number
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  onVideoElement?: (element: HTMLVideoElement | null) => void
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
  maxImageScale?: number
  interactiveImageLayerIndexes?: readonly number[]
  viewportKey?: string
}

export function multipleLayerVideoPreviewPropsEqual(
  previous: MultipleLayerVideoPreviewLrcRenderProps,
  next: MultipleLayerVideoPreviewLrcRenderProps,
): boolean {
  return (
    previous.active === next.active
    &&
    previous.playing === next.playing
    && previous.compositionTime === next.compositionTime
    && previous.decodeQuality === next.decodeQuality
    && previous.canvasWidth === next.canvasWidth
    && previous.canvasHeight === next.canvasHeight
    && previous.maxSide === next.maxSide
    && previous.className === next.className
    && previous.imageScale === next.imageScale
    && previous.maxImageScale === next.maxImageScale
    && previous.viewportKey === next.viewportKey
    && previous.onImageScaleChange === next.onImageScaleChange
    && JSON.stringify(previous.interactiveImageLayerIndexes) === JSON.stringify(next.interactiveImageLayerIndexes)
    && JSON.stringify(previous.layers) === JSON.stringify(next.layers)
  )
}

interface RenderFrameOptions {
  lrc: LunaRenderCore
  canvas: HTMLCanvasElement
  layers: PreviewLayer[]
  videoStates: Map<string, VideoStateEntry>
  imageTextures: Map<string, number>
  compositionTime: number | undefined
  canvasWidth: number | undefined
  canvasHeight: number | undefined
  maxSide: number
  textureVersion: number
  getTextureVersion: () => number
  isDestroyed: () => boolean
}

export type RenderFrameResult = 'empty' | 'rendered' | 'stale'

export const perfLog = (msg: string): void => {
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] ${msg}`)
}

export function normalizedPreviewMaxSide(maxSide: number | undefined): number {
  const requested = typeof maxSide === 'number' && Number.isFinite(maxSide)
    ? maxSide
    : DEFAULT_PREVIEW_MAX_SIDE
  return Math.min(PREVIEW_HARD_MAX_SIDE, Math.max(1, Math.round(requested)))
}

export function calcRenderSize(vw: number, vh: number, maxSide: number): [number, number] {
  const maxEdge = Math.max(vw, vh)
  if (maxEdge <= maxSide) return [vw, vh]
  const scale = maxSide / maxEdge
  return [Math.round(vw * scale), Math.round(vh * scale)]
}

export function calcOutputSize(cw: number, ch: number, maxSide: number): [number, number] {
  const maxEdge = Math.max(cw, ch)
  if (maxEdge <= maxSide) return [cw, ch]
  const scale = maxSide / maxEdge
  return [Math.round(cw * scale), Math.round(ch * scale)]
}

export function computeLayerDecodeMaxSide(
  layer: PreviewLayer,
  canvasW: number | undefined,
  canvasH: number | undefined,
  quality: number,
  outputMaxSide: number,
): number {
  if (quality <= 0 || !canvasW || !canvasH) return outputMaxSide
  const [previewWidth, previewHeight] = calcOutputSize(canvasW, canvasH, outputMaxSide)
  const displayWidth = previewWidth * (layer.dstW || 1)
  const displayHeight = previewHeight * (layer.dstH || 1)
  return Math.min(Math.round(Math.max(displayWidth, displayHeight, 1) * quality), outputMaxSide)
}

export function videoLayerKey(layer: PreviewLayer): string {
  return layer.videoSourceKey
    ? `shared_${layer.videoSourceKey}_${layer.filePath}`
    : `v_${layer.filePath}_${layer.videoTime ?? 0}`
}

export function describeVideoLoadFailure(filePath: string, error: MediaError | null): string {
  return `视频加载失败\n文件: ${filePath}\n错误代码: ${error?.code ?? '未知'}\n错误信息: ${error?.message || '未提供'}`
}

async function loadImageTexture(
  lrc: LunaRenderCore,
  imageTextures: Map<string, number>,
  filePath: string,
): Promise<number> {
  const cached = imageTextures.get(filePath)
  if (cached !== undefined) return cached

  const image = new Image()
  image.src = filePathToPreviewUrl(filePath) ?? filePath
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(`图片加载失败: ${filePath}`))
  })
  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('OffscreenCanvas 2D context 不可用')
  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, width, height)
  const rgba = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  )
  const textureId = await lrc.loadTexture(rgba as unknown as Buffer, width, height)
  imageTextures.set(filePath, textureId)
  return textureId
}

async function loadMaskTexture(
  lrc: LunaRenderCore,
  imageTextures: Map<string, number>,
  projectId: string,
  filePath: string,
): Promise<number> {
  const cached = imageTextures.get(filePath)
  if (cached !== undefined) return cached
  const mask = await window.luna.workspace.loadColorMask(projectId, filePath)
  const source = new Uint8Array(mask.bytes)
  const rgba = new Uint8Array(source.length * 4)
  for (let index = 0; index < source.length; index += 1) {
    const offset = index * 4
    rgba[offset] = source[index]
    rgba[offset + 1] = source[index]
    rgba[offset + 2] = source[index]
    rgba[offset + 3] = 255
  }
  const textureId = await lrc.loadTexture(rgba as unknown as Buffer, mask.width, mask.height)
  imageTextures.set(filePath, textureId)
  return textureId
}

async function videoTexture(
  lrc: LunaRenderCore,
  layer: PreviewLayer,
  entry: VideoStateEntry,
  videoStates: Map<string, VideoStateEntry>,
): Promise<number | null> {
  const targetTime = layer.videoTime ?? 0
  if (Math.abs(entry.prevVideoTime - targetTime) > 0.01) {
    entry.video.currentTime = targetTime
    entry.prevVideoTime = targetTime
  }

  const context = entry.offscreen?.getContext('2d', { willReadFrequently: true })
  if (!context || !entry.offscreen) return null
  const currentVideoTime = entry.video.currentTime
  // Color-only preview updates should reuse the paused frame. Re-reading the
  // video into RGBA and sending it through IPC for every slider tick makes the
  // preview queue fall behind the drag.
  if (entry.textureId > 0 && Math.abs(entry.lastUploadedVideoTime - currentVideoTime) <= 0.0001) {
    return entry.textureId
  }
  context.clearRect(0, 0, entry.renderW, entry.renderH)
  context.drawImage(entry.video, 0, 0, entry.renderW, entry.renderH)
  const imageData = context.getImageData(0, 0, entry.renderW, entry.renderH)
  const rgba = new Uint8Array(
    imageData.data.buffer,
    imageData.data.byteOffset,
    imageData.data.byteLength,
  )

  if (entry.textureId === 0) {
    entry.textureId = await lrc.loadTexture(rgba as unknown as Buffer, entry.renderW, entry.renderH)
    if (videoStates.get(entry.key) !== entry) {
      void lrc.releaseTexture(entry.textureId).catch(() => {})
      entry.textureId = 0
      return null
    }
  } else {
    await lrc.updateTexture(entry.textureId, rgba as unknown as Buffer)
    if (videoStates.get(entry.key) !== entry) return null
  }
  entry.lastUploadedVideoTime = currentVideoTime
  return entry.textureId
}

function layerPositioning(layer: PreviewLayer): unknown {
  if (!layer.positioning || typeof layer.positioning !== 'object' || !('anchor' in layer.positioning)) {
    return undefined
  }
  const positioning = layer.positioning as unknown as Record<string, unknown>
  return {
    anchor: String(positioning.anchor ?? ''),
    targetWidth: Number(positioning.targetWidth) || 0,
    marginX: positioning.marginX ?? 0,
    marginY: positioning.marginY ?? 0,
  }
}

export async function renderMultipleLayerVideoFrame(
  options: RenderFrameOptions,
): Promise<RenderFrameResult> {
  const {
    lrc,
    canvas,
    layers,
    videoStates,
    imageTextures,
    compositionTime,
    canvasWidth,
    canvasHeight,
    maxSide,
    textureVersion,
    getTextureVersion,
    isDestroyed,
  } = options
  const renderLayers: Array<Record<string, unknown> & { zIndex: number }> = []
  const usedImageTextures = new Set<string>()
  const frameVideoTextures = new Map<string, number>()
  const primaryVideoIndex = layers.findIndex((layer) => layer.isVideo)
  const primaryVideoLayer = primaryVideoIndex >= 0 ? layers[primaryVideoIndex] : undefined
  const primaryVideo = primaryVideoLayer
    ? videoStates.get(videoLayerKey(primaryVideoLayer))?.video
    : undefined
  const frameCompositionTime = Number.isFinite(compositionTime)
    ? Math.max(0, compositionTime!)
    : primaryVideoLayer && primaryVideo
      ? compositionTimeForVideoLayer(primaryVideoLayer, primaryVideo.currentTime)
      : 0

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]
    let textureId: number
    const usesSourceTexture = !layer.layerType || layer.layerType === 'media' || layer.layerType === 'local-color'
    if (!usesSourceTexture) {
      textureId = 0
    } else if (layer.isVideo) {
      const key = videoLayerKey(layer)
      const entry = videoStates.get(key)
      if (!entry?.ready) continue
      const sharedTexture = frameVideoTextures.get(key)
      if (sharedTexture !== undefined) {
        textureId = sharedTexture
      } else {
        const nextTexture = await videoTexture(lrc, layer, entry, videoStates)
        if (nextTexture === null) continue
        textureId = nextTexture
        frameVideoTextures.set(key, textureId)
      }
    } else {
      usedImageTextures.add(layer.filePath)
      try {
        textureId = await loadImageTexture(lrc, imageTextures, layer.filePath)
      } catch {
        console.error('[MultipleLayerVideoPreviewLrcRender] failed to load image:', layer.filePath)
        continue
      }
    }

    const maskTime = Math.max(0, (layer.videoTime ?? 0) + frameCompositionTime - (layer.videoOffset ?? 0))
    const timelineSample = maskTimelineSampleAt(layer.maskTimeline, maskTime)
    if (layer.maskTimeline && !timelineSample?.path) continue
    const resolvedMaskPath = timelineSample?.path ?? layer.maskPath
    let maskTextureId: number | undefined
    if (resolvedMaskPath && layer.maskProjectId) {
      usedImageTextures.add(resolvedMaskPath)
      try {
        maskTextureId = await loadMaskTexture(lrc, imageTextures, layer.maskProjectId, resolvedMaskPath)
      } catch {
        console.warn('[MultipleLayerVideoPreviewLrcRender] failed to load mask:', resolvedMaskPath)
        if (layer.maskTimeline) continue
      }
    }
    const maskTransform = timelineSample?.transform ?? (layer.maskTrack
      ? maskTrackTransformAt(layer.maskTrack, maskTime)
      : undefined)

    renderLayers.push({
      textureId,
      fit: layer.fit,
      dstX: layer.dstX ?? 0,
      dstY: layer.dstY ?? 0,
      dstW: layer.dstW ?? 1,
      dstH: layer.dstH ?? 1,
      srcX: layer.srcX ?? 0,
      srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1,
      srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      blendMode: layer.blendMode,
      revealProgress: layer.reveal ? compositionRevealProgress(layer.reveal, frameCompositionTime) : 1,
      zIndex: layer.zIndex ?? 0,
      color: layer.color,
      maskTextureId,
      maskOpacity: layer.maskOpacity,
      maskInverted: layer.maskInverted,
      maskFeather: layer.maskFeather,
      maskTransform,
      transform: layer.transform,
      positioning: layerPositioning(layer),
      restoreLutId: layer.restoreLutId,
      lutId: layer.lutId,
      lutIntensity: layer.lutIntensity,
      layerType: layer.layerType ?? 'media',
      precomposeGroup: layer.precomposeGroup,
      precomposeRole: layer.precomposeRole,
      shape: layer.shape,
      fillColor: layer.fillColor,
      cornerRadius: layer.cornerRadius,
      strokeColor: layer.strokeColor,
      strokeWidth: layer.strokeWidth,
      content: layer.content,
      fontSize: layer.fontSize,
      fontFamily: layer.fontFamily,
      fontFile: layer.fontFile,
      fontWeight: layer.fontWeight,
      textColor: layer.textColor,
      textAlign: layer.textAlign,
      verticalAlign: layer.verticalAlign,
      activeStart: layer.activeStart,
      activeEnd: layer.activeEnd,
    })
  }

  for (const [filePath, textureId] of imageTextures) {
    if (usedImageTextures.has(filePath)) continue
    void lrc.releaseTexture(textureId).catch(() => {})
    imageTextures.delete(filePath)
  }
  if (renderLayers.length === 0) return 'empty'
  renderLayers.sort((left, right) => left.zIndex - right.zIndex)

  const [outputWidth, outputHeight] = canvasWidth && canvasHeight
    ? calcOutputSize(canvasWidth, canvasHeight, maxSide)
    : [maxSide, Math.round(maxSide * 0.75)]
  if (isDestroyed() || getTextureVersion() !== textureVersion) return 'stale'

  const pixels = await lrc.renderFrame(outputWidth, outputHeight, renderLayers, frameCompositionTime)
  if (isDestroyed()) return 'stale'
  canvas.width = outputWidth
  canvas.height = outputHeight
  const displayContext = canvas.getContext('2d')
  if (displayContext) {
    displayContext.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), outputWidth, outputHeight),
      0,
      0,
    )
  }

  const perfWindow = window as Window & { __firstRenderDone?: boolean; __perfStart?: number }
  if (perfWindow.__firstRenderDone === undefined) {
    perfWindow.__firstRenderDone = true
    const elapsed = performance.now() - (perfWindow.__perfStart ?? performance.now())
    perfLog(`FIRST RENDER at ${elapsed.toFixed(0)}ms`)
  }
  return 'rendered'
}

export function releasePreviewTextures(
  lrc: LunaRenderCore,
  videoStates: Map<string, VideoStateEntry>,
  imageTextures: Map<string, number>,
): void {
  for (const entry of videoStates.values()) {
    if (entry.textureId <= 0) continue
    void lrc.releaseTexture(entry.textureId).catch(() => {})
    entry.textureId = 0
    entry.lastUploadedVideoTime = -1
  }
  for (const [filePath, textureId] of imageTextures) {
    void lrc.releaseTexture(textureId).catch(() => {})
    imageTextures.delete(filePath)
  }
}
