import { filePathToPreviewUrl } from '../../lib/fileUtils'
import { logger } from '../../lib/rendererLogger'
import type { PreviewLayer } from '../../shared/types'
import { maskTimelineSampleAt } from '../../workspace/mask/maskTimeline'
import { maskTrackTransformAt } from '../../workspace/mask/maskTrack'
import {
  calcRenderSize,
  computeLayerDecodeMaxSide,
  videoLayerKey,
} from '../multipleLayerVideoFrameRenderer'
import { encodeWebGpuColorMask, parseWebGpuCube } from '../webgpuPreviewMath'
import { rasterizeWebGpuText, webGpuFontFamily } from '../webgpuTextRaster'
import {
  createTexture,
  prepareScaledUploadSource,
  TEXTURE_USAGE_COPY_DST,
  TEXTURE_USAGE_RENDER_ATTACHMENT,
  TEXTURE_USAGE_TEXTURE_BINDING,
  writeTexture,
} from './webgpuGpu'
import type {
  ExternalImageResource,
  GpuDevice,
  GpuImageResource,
  GpuLutResource,
  GpuMaskResource,
  GpuVideoEntry,
  LayerResources,
} from './webgpuTypes'

const IDENTITY_MASK_RGBA = new Uint8Array([255, 255, 255, 255])
const IDENTITY_SOURCE_RGBA = new Uint8Array([255, 255, 255, 255])
const VIDEO_TEXTURE_FORMAT = 'rgba8unorm-srgb'

export interface WebGpuResourceCallbacks {
  getDevice: () => GpuDevice | null
  getCanvasSize: () => { width: number; height: number }
  getRenderSize: () => { width: number; height: number }
  getMaxSide: () => number
  getFrameCounter: () => number
  isPlaying: () => boolean
  isActive: () => boolean
  isDestroyed: () => boolean
  rasterizeImages: boolean
  waitForGpu: boolean
  scheduleRender: () => void
  onVideoMetadata: () => void
  onVideoReady: () => void
  onVideoSeeked: () => void
  onVideoTimeUpdate: () => void
  onVideoError: (reason: string) => void
}

export class WebGpuResourceManager {
  private readonly callbacks: WebGpuResourceCallbacks
  private readonly videos = new Map<string, GpuVideoEntry>()
  private readonly images = new Map<string, GpuImageResource>()
  private readonly masks = new Map<string, GpuMaskResource>()
  private readonly luts = new Map<string, GpuLutResource>()
  private readonly textTextures = new Map<string, GpuImageResource>()
  private readonly fontFamilies = new Map<string, Promise<string>>()
  private readonly ownedObjectUrls = new Set<string>()
  private readonly loggedVideoSizes = new Set<string>()
  private device: GpuDevice | null = null
  private identitySource: GpuImageResource | null = null
  private identityMask: GpuMaskResource | null = null
  private identityLut: GpuLutResource | null = null
  private destroyed = false

  constructor(callbacks: WebGpuResourceCallbacks) {
    this.callbacks = callbacks
  }

  get videoEntries(): IterableIterator<GpuVideoEntry> {
    return this.videos.values()
  }

  get primaryVideoEntries(): ReadonlyMap<string, GpuVideoEntry> {
    return this.videos
  }

  get identitySourceResource(): GpuImageResource | null {
    return this.identitySource
  }

  setDevice(device: GpuDevice): void {
    this.device = device
  }

  createDefaultResources(): void {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const sourceTexture = createTexture(device, 1, 1, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, sourceTexture, IDENTITY_SOURCE_RGBA, 1, 1)
    this.identitySource = { texture: sourceTexture, width: 1, height: 1 }

    const maskTexture = createTexture(device, 1, 1, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, maskTexture, IDENTITY_MASK_RGBA, 1, 1)
    this.identityMask = { texture: maskTexture, width: 1, height: 1 }

    const lutTexture = createTexture(device, 2, 2, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING, 2)
    const identityLut = new Uint8Array(2 * 2 * 2 * 4)
    for (let z = 0; z < 2; z += 1) for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
      const index = (z * 4 + y * 2 + x) * 4
      identityLut[index] = x * 255
      identityLut[index + 1] = y * 255
      identityLut[index + 2] = z * 255
      identityLut[index + 3] = 255
    }
    writeTexture(device, lutTexture, identityLut, 2, 2, 2)
    this.identityLut = { texture: lutTexture, size: 0 }
  }

  hasReadyVideo(layer: PreviewLayer): boolean {
    return this.videos.get(videoLayerKey(layer))?.ready === true
  }

  entryForLayer(layer: PreviewLayer): GpuVideoEntry | undefined {
    return this.videos.get(videoLayerKey(layer))
  }

  async syncVideoElements(layers: PreviewLayer[]): Promise<void> {
    const required = new Map<string, PreviewLayer>()
    for (const layer of layers) {
      if (layer.isVideo) required.set(videoLayerKey(layer), layer)
    }
    const audioEnabledKey = required.size === 1 ? required.keys().next().value : null
    logger.info('[PreviewDebug] sync video elements', {
      required: [...required.entries()].map(([key, layer]) => ({ key, path: layer.filePath })),
      existing: this.videos.size,
    })
    for (const [key, entry] of this.videos) {
      if (required.has(key)) continue
      entry.video.pause()
      entry.video.removeAttribute('src')
      entry.video.load()
      entry.resource?.texture.destroy?.()
      this.videos.delete(key)
    }
    for (const [key, layer] of required) {
      const existing = this.videos.get(key)
      if (existing) {
        existing.video.muted = key !== audioEnabledKey
        continue
      }
      const video = document.createElement('video')
      video.preload = 'auto'
      video.playsInline = true
      video.loop = false
      video.muted = key !== audioEnabledKey
      video.crossOrigin = 'anonymous'
      video.src = filePathToPreviewUrl(layer.filePath) ?? layer.filePath
      const entry: GpuVideoEntry = { key, video, ready: false, resource: null, uploadCanvas: null, lastUploadedFrame: -1 }
      logger.info('[PreviewDebug] video element created', {
        key,
        src: video.src,
        preload: video.preload,
        muted: video.muted,
      })
      video.addEventListener('loadeddata', () => {
        if (this.destroyed || this.videos.get(key) !== entry) return
        entry.ready = true
        logger.info('[PreviewDebug] video loadeddata', {
          key,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          duration: video.duration,
          currentTime: video.currentTime,
          networkState: video.networkState,
        })
        if (this.callbacks.isPlaying() && this.callbacks.isActive()) void entry.video.play().catch(() => undefined)
        this.callbacks.onVideoReady()
      })
      video.addEventListener('loadedmetadata', () => {
        logger.info('[PreviewDebug] video loadedmetadata', {
          key,
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          duration: video.duration,
          networkState: video.networkState,
        })
        this.callbacks.onVideoMetadata()
      })
      video.addEventListener('canplay', () => {
        logger.info('[PreviewDebug] video canplay', {
          key,
          readyState: video.readyState,
          currentTime: video.currentTime,
        })
        this.callbacks.scheduleRender()
      })
      video.addEventListener('seeked', () => this.callbacks.onVideoSeeked())
      video.addEventListener('timeupdate', () => this.callbacks.onVideoTimeUpdate())
      video.addEventListener('error', () => {
        if (this.destroyed || this.callbacks.isDestroyed()) return
        logger.error('[PreviewDebug] video element error', {
          key,
          src: video.src,
          readyState: video.readyState,
          networkState: video.networkState,
          mediaError: video.error ? { code: video.error.code, message: video.error.message } : null,
        })
        this.callbacks.onVideoError(`视频无法在 WebGPU 预览中打开（错误代码 ${video.error?.code ?? '未知'}）`)
      })
      this.videos.set(key, entry)
      video.load()
    }
    this.callbacks.onVideoMetadata()
    for (const entry of this.videos.values()) {
      if (entry.ready && this.callbacks.isPlaying() && this.callbacks.isActive()) await entry.video.play().catch(() => undefined)
    }
  }

  async layerResources(
    layer: PreviewLayer,
    time: number,
    overrides: Map<string, GpuImageResource>,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<LayerResources> {
    const source = await this.resourceForLayer(layer, overrides, canvasWidth, canvasHeight)
    const maskTime = Math.max(0, numberOr(layer.videoTime, 0) + time - numberOr(layer.videoOffset, 0))
    const timelineSample = maskTimelineSampleAt(layer.maskTimeline, maskTime)
    if (layer.maskTimeline && !timelineSample?.path) throw new Error('动态蒙版当前帧尚未准备好')
    const resolvedMaskPath = timelineSample?.path ?? layer.maskPath
    const mask = resolvedMaskPath && layer.maskProjectId
      ? await this.maskResource(layer, resolvedMaskPath)
      : this.identityMask
    if (!mask) throw new Error('WebGPU 默认蒙版未初始化')
    const lut = layer.lutId ? await this.lutResource(layer.lutId) : this.identityLut
    const restoreLut = layer.restoreLutId ? await this.lutResource(layer.restoreLutId) : this.identityLut
    if (!lut || !restoreLut) throw new Error('WebGPU 默认调色文件未初始化')
    const maskTransform = timelineSample?.transform ?? (layer.maskTrack
      ? maskTrackTransformAt(layer.maskTrack, maskTime)
      : undefined)
    return {
      source,
      mask,
      lut,
      restoreLut,
      maskPresent: Boolean(resolvedMaskPath && layer.maskProjectId),
      maskTransform,
    }
  }

  async resourceForLayer(
    layer: PreviewLayer,
    overrides: Map<string, GpuImageResource>,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<GpuImageResource> {
    if (layer.precomposeRole === 'output' && layer.precomposeGroup) {
      const resource = overrides.get(layer.precomposeGroup)
      if (!resource) throw new Error('预览合成层未准备好')
      return resource
    }
    if (layer.layerType === 'shape') {
      if (!this.identitySource) throw new Error('WebGPU 默认纹理未初始化')
      return this.identitySource
    }
    if (layer.layerType === 'text' || layer.layerType === 'logo') return this.textResource(layer, canvasWidth, canvasHeight)
    if (layer.isVideo) {
      const entry = this.videos.get(videoLayerKey(layer))
      if (!entry?.ready) throw new Error('视频尚未准备好')
      return this.videoResource(layer, entry)
    }
    return this.imageResource(layer.filePath)
  }

  private async loadImage(path: string): Promise<ExternalImageResource> {
    const directUrl = filePathToPreviewUrl(path) ?? path
    const load = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error(`图片无法在 WebGPU 预览中打开: ${path}`))
      image.src = url
    })
    try {
      const image = await load(directUrl)
      return { source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
    } catch {
      const preview = await window.luna.workspace.loadPreview(path)
      const blobUrl = URL.createObjectURL(new Blob([preview.buffer], { type: preview.mimeType }))
      try {
        const image = await load(blobUrl)
        this.ownedObjectUrls.add(blobUrl)
        return { source: image, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, ownedUrl: blobUrl }
      } catch (error) {
        URL.revokeObjectURL(blobUrl)
        throw error
      }
    }
  }

  private async imageResource(path: string): Promise<GpuImageResource> {
    const cached = this.images.get(path)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const source = await this.loadImage(path)
    const [width, height] = calcRenderSize(source.width || 1, source.height || 1, this.callbacks.getMaxSide())
    const texture = createTexture(
      device,
      width,
      height,
      'rgba8unorm-srgb',
      TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
    )
    if (this.callbacks.rasterizeImages) {
      const rasterCanvas = document.createElement('canvas')
      rasterCanvas.width = width
      rasterCanvas.height = height
      const rasterContext = rasterCanvas.getContext('2d', { willReadFrequently: true })
      if (!rasterContext) throw new Error('无法准备 WebGPU 图片纹理')
      rasterContext.drawImage(source.source, 0, 0, width, height)
      const pixels = rasterContext.getImageData(0, 0, width, height).data
      writeTexture(device, texture, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength), width, height)
    } else {
      const upload = await prepareScaledUploadSource(source.source, source.width, source.height, width, height)
      try {
        device.queue.copyExternalImageToTexture({ source: upload.source }, { texture }, { width, height })
      } finally {
        upload.dispose()
      }
    }
    if (this.callbacks.waitForGpu) await device.queue.onSubmittedWorkDone?.()
    const resource = { texture, width, height, external: source }
    this.images.set(path, resource)
    this.callbacks.scheduleRender()
    return resource
  }

  private async videoResource(layer: PreviewLayer, entry: GpuVideoEntry): Promise<GpuImageResource> {
    const device = this.device
    if (!device || !entry.ready) throw new Error('视频尚未准备好')
    // A seek can briefly lower readyState after the first frame has already
    // been uploaded. Keep the previous texture until the new frame is ready.
    if (entry.video.readyState < 2 && entry.resource) return entry.resource
    const displayMaxSide = Math.max(this.callbacks.getRenderSize().width, this.callbacks.getRenderSize().height)
    const canvasSize = this.callbacks.getCanvasSize()
    const qualityMaxSide = computeLayerDecodeMaxSide(
      layer,
      canvasSize.width,
      canvasSize.height,
      1.5,
      Math.max(this.callbacks.getMaxSide(), displayMaxSide),
    )
    const layerMaxSide = Math.max(qualityMaxSide, displayMaxSide)
    const [width, height] = calcRenderSize(entry.video.videoWidth || 1280, entry.video.videoHeight || 720, layerMaxSide)
    if (!entry.resource || entry.resource.width !== width || entry.resource.height !== height) {
      entry.resource?.texture.destroy?.()
      entry.resource = {
        // Chromium's video upload path uses an internal render pass on some
        // backends, so the destination must also allow render attachment use.
        texture: createTexture(
          device,
          width,
          height,
          // Video frames are display-encoded sRGB after Chromium's media
          // conversion. Mark the texture accordingly so sampling decodes to
          // linear light before the shared color pipeline runs.
          VIDEO_TEXTURE_FORMAT,
          TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
        ),
        width,
        height,
        external: { source: entry.video, width: entry.video.videoWidth || width, height: entry.video.videoHeight || height },
      }
      const sizeKey = `${videoLayerKey(layer)}:${width}x${height}`
      if (!this.loggedVideoSizes.has(sizeKey)) {
        this.loggedVideoSizes.add(sizeKey)
        logger.info('[WebGPU诊断] 视频纹理尺寸', {
          layerKey: videoLayerKey(layer),
          sourceWidth: entry.video.videoWidth || width,
          sourceHeight: entry.video.videoHeight || height,
          textureWidth: width,
          textureHeight: height,
          textureFormat: VIDEO_TEXTURE_FORMAT,
          renderWidth: this.callbacks.getRenderSize().width,
          renderHeight: this.callbacks.getRenderSize().height,
          maxSide: layerMaxSide,
        })
      }
    }
    if (entry.lastUploadedFrame !== this.callbacks.getFrameCounter()) {
      const firstUpload = entry.lastUploadedFrame < 0
      const upload = await prepareScaledUploadSource(
        entry.video,
        entry.video.videoWidth || width,
        entry.video.videoHeight || height,
        width,
        height,
        entry.uploadCanvas ?? undefined,
      )
      if (upload.source !== entry.video) entry.uploadCanvas = upload.source as typeof entry.uploadCanvas
      try {
        await this.withGpuValidationScope('WebGPU 视频纹理上传', () => {
          device.queue.copyExternalImageToTexture(
            { source: upload.source },
            { texture: entry.resource!.texture },
            { width, height },
          )
        })
      } finally {
        upload.dispose()
      }
      entry.lastUploadedFrame = this.callbacks.getFrameCounter()
      if (firstUpload) {
        logger.info('[PreviewDebug] first video texture upload submitted', {
          key: entry.key,
          frameCounter: entry.lastUploadedFrame,
          currentTime: entry.video.currentTime,
          readyState: entry.video.readyState,
          videoWidth: entry.video.videoWidth,
          videoHeight: entry.video.videoHeight,
          textureWidth: width,
          textureHeight: height,
          textureFormat: VIDEO_TEXTURE_FORMAT,
          scaledThroughCanvas: upload.source !== entry.video,
        })
      }
    }
    return entry.resource
  }

  private async withGpuValidationScope(label: string, operation: () => void): Promise<void> {
    const device = this.device
    if (!device?.pushErrorScope || !device.popErrorScope) {
      operation()
      return
    }
    device.pushErrorScope('validation')
    try {
      operation()
    } catch (error) {
      await device.popErrorScope().catch(() => null)
      throw error
    }
    const gpuError = await device.popErrorScope()
    if (gpuError) {
      logger.error('[WebGPU诊断] GPU 提交失败', { label, name: gpuError.name ?? 'validation', message: gpuError.message ?? '' })
      throw new Error(`${label}: ${gpuError.message || gpuError.name || 'GPU validation error'}`)
    }
  }

  private async maskResource(layer: PreviewLayer, path: string): Promise<GpuMaskResource> {
    const key = `${layer.maskProjectId ?? ''}:${path}`
    const cached = this.masks.get(key)
    if (cached) return cached
    const device = this.device
    if (!device || !layer.maskProjectId) throw new Error('蒙版所属项目不可用')
    const mask = await window.luna.workspace.loadColorMask(layer.maskProjectId, path)
    const source = new Uint8Array(mask.bytes)
    const rgba = encodeWebGpuColorMask(source, mask.width, mask.height)
    const texture = createTexture(device, mask.width, mask.height, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, texture, rgba, mask.width, mask.height)
    const resource = { texture, width: mask.width, height: mask.height }
    this.masks.set(key, resource)
    this.callbacks.scheduleRender()
    return resource
  }

  private async lutResource(path: string): Promise<GpuLutResource> {
    const cached = this.luts.get(path)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    try {
      const data = await window.luna.workspace.loadLut(path)
      const parsed = parseWebGpuCube(new TextDecoder().decode(data))
      const texture = createTexture(device, parsed.size, parsed.size, 'rgba8unorm', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING, parsed.size)
      writeTexture(device, texture, parsed.rgba, parsed.size, parsed.size, parsed.size)
      const resource = { texture, size: parsed.size }
      this.luts.set(path, resource)
      this.callbacks.scheduleRender()
      return resource
    } catch (error: unknown) {
      logger.warn('[WebGPU诊断] LUT 加载失败', { path, error: error instanceof Error ? error.message : String(error) })
      throw new Error('调色文件无法在 WebGPU 预览中打开')
    }
  }

  private async fontFamilyFor(layer: PreviewLayer): Promise<string> {
    const namedFallback = layer.fontFamily?.trim()
    const fallback = namedFallback ? `${namedFallback}, sans-serif` : 'sans-serif'
    const fontFile = layer.fontFile?.trim()
    if (!fontFile) return fallback
    const family = webGpuFontFamily(fontFile)
    let pending = this.fontFamilies.get(fontFile)
    if (!pending) {
      pending = (async () => {
        const bytes = await window.luna.workspace.loadFont(fontFile)
        const face = new FontFace(family, bytes, { style: 'normal', weight: '400' })
        await face.load()
        document.fonts.add(face)
        return family
      })().catch((error: unknown) => {
        this.fontFamilies.delete(fontFile)
        throw error
      })
      this.fontFamilies.set(fontFile, pending)
    }
    try {
      return await pending
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      logger.error('[WebGPU诊断] 字体加载失败，停止 WebGPU 预览', { fontFile, error: reason })
      throw new Error(`字体文件无法在 WebGPU 预览中打开: ${fontFile}`)
    }
  }

  private async textResource(layer: PreviewLayer, canvasWidth: number, canvasHeight: number): Promise<GpuImageResource> {
    const key = JSON.stringify([
      layer.fontFile ?? '', layer.fontFamily ?? '', layer.fontWeight ?? 400, layer.fontSize ?? 16,
      layer.textColor ?? '', layer.textAlign ?? 'left', layer.verticalAlign ?? 'middle', layer.content ?? '',
      canvasWidth, canvasHeight, layer.dstW, layer.dstH,
    ])
    const cached = this.textTextures.get(key)
    if (cached) return cached
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    const family = await this.fontFamilyFor(layer)
    const raster = rasterizeWebGpuText(layer, canvasWidth, canvasHeight, family)
    const texture = createTexture(device, raster.width, raster.height, 'rgba8unorm-srgb', TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_TEXTURE_BINDING)
    writeTexture(device, texture, raster.rgba, raster.width, raster.height)
    if (this.callbacks.waitForGpu) await device.queue.onSubmittedWorkDone?.()
    const resource = { texture, width: raster.width, height: raster.height }
    this.textTextures.set(key, resource)
    this.callbacks.scheduleRender()
    return resource
  }

  clearImageResources(): void {
    for (const resource of this.images.values()) resource.texture.destroy?.()
    this.images.clear()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    for (const entry of this.videos.values()) {
      entry.video.pause()
      entry.video.removeAttribute('src')
      entry.video.load()
      entry.resource?.texture.destroy?.()
    }
    this.videos.clear()
    for (const resource of this.images.values()) resource.texture.destroy?.()
    for (const resource of this.masks.values()) resource.texture.destroy?.()
    for (const resource of this.luts.values()) resource.texture.destroy?.()
    for (const resource of this.textTextures.values()) resource.texture.destroy?.()
    this.identitySource?.texture.destroy?.()
    this.identityMask?.texture.destroy?.()
    this.identityLut?.texture.destroy?.()
    for (const objectUrl of this.ownedObjectUrls) URL.revokeObjectURL(objectUrl)
    this.images.clear()
    this.masks.clear()
    this.luts.clear()
    this.textTextures.clear()
    this.fontFamilies.clear()
    this.ownedObjectUrls.clear()
    this.identitySource = null
    this.identityMask = null
    this.identityLut = null
  }
}

function numberOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
