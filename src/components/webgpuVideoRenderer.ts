import { logger } from '../lib/rendererLogger'
import type { PreviewLayer } from '../shared/types'
import { videoLayerKey } from './multipleLayerVideoFrameRenderer'
import { WEBGPU_COMPOSITOR_SHADER } from './webgpuShader'
import {
  PARAM_FLOAT_COUNT,
  TEXTURE_USAGE_COPY_SRC,
  TEXTURE_USAGE_COPY_DST,
  TEXTURE_USAGE_RENDER_ATTACHMENT,
  TEXTURE_USAGE_TEXTURE_BINDING,
  createTexture,
  getWebGpuContext,
  getWebGpuNavigator,
  srgbFormatFor,
  playAndWaitForVideoFrame,
  seekVideo,
  waitForVideoReady,
} from './webgpu/webgpuGpu'
import { numberOr } from './webgpu/webgpuLayerMath'
import { WebGpuLayerRenderer } from './webgpu/webgpuLayerRenderer'
import { readWebGpuOutputFrame } from './webgpu/webgpuReadback'
import { WebGpuResourceManager } from './webgpu/webgpuResources'
import type {
  GpuCanvasContext,
  GpuDevice,
  GpuImageResource,
  GpuPipeline,
  GpuSampler,
  GpuShaderModule,
  PendingVideoSeek,
  RenderWaiter,
  WebGpuRenderCanvas,
  WebGpuVideoRendererOptions,
} from './webgpu/webgpuTypes'

export type { WebGpuRenderCanvas } from './webgpu/webgpuTypes'

export class WebGpuVideoRenderer {
  private readonly canvas: WebGpuRenderCanvas
  private readonly options: WebGpuVideoRendererOptions
  private readonly resources: WebGpuResourceManager
  private readonly layerRenderer: WebGpuLayerRenderer
  private readonly precompositions = new Map<string, GpuImageResource>()
  private readonly pipelines = new Map<string, GpuPipeline>()
  private device: GpuDevice | null = null
  private context: GpuCanvasContext | null = null
  private bindGroupLayout: object | null = null
  private pipelineLayout: object | null = null
  private sampler: GpuSampler | null = null
  private shader: GpuShaderModule | null = null
  private canvasFormat = ''
  private presentationFormat = ''
  private outputTexture: GpuImageResource | null = null
  private canvasWidth: number
  private canvasHeight: number
  private renderWidth = 1
  private renderHeight = 1
  private layers: PreviewLayer[] = []
  private compositionTime = 0
  private playbackStartCompositionTime: number | null = null
  private playing = false
  private active = true
  private initialized = false
  private destroyed = false
  private failed = false
  private renderInFlight = false
  private renderQueued = false
  private directRenderQueued = false
  private imageResourcesInvalidated = false
  private readonly renderWaiters = new Set<RenderWaiter>()
  private resizeQueued = false
  private renderRevision = 0
  private frameCounter = 0
  private renderFrameId = 0
  private playbackFrameId = 0
  private playbackLayerSignature = ''
  private lastPlaybackRenderAt = -Infinity
  private currentPrimaryVideo: HTMLVideoElement | null = null
  private lastFailureReason = ''
  private lastLayerSummary = ''
  private firstRenderLogged = false
  private exportFrameCounter = 0
  private lastVideoTargetConflictLogFrame = -Infinity


  constructor(canvas: WebGpuRenderCanvas, options: WebGpuVideoRendererOptions) {
    this.canvas = canvas
    this.options = options
    this.canvasWidth = Math.max(1, Math.round(options.canvasWidth))
    this.canvasHeight = Math.max(1, Math.round(options.canvasHeight))
    this.resources = new WebGpuResourceManager({
      getDevice: () => this.device,
      getCanvasSize: () => ({ width: this.canvasWidth, height: this.canvasHeight }),
      getRenderSize: () => ({ width: this.renderWidth, height: this.renderHeight }),
      getMaxSide: () => this.options.maxSide,
      getFrameCounter: () => this.frameCounter,
      isPlaying: () => this.playing,
      isActive: () => this.active,
      isDestroyed: () => this.destroyed,
      rasterizeImages: Boolean(options.rasterizeImages),
      waitForGpu: Boolean(options.waitForGpu),
      scheduleRender: () => this.scheduleRender(),
      onVideoMetadata: () => this.updatePrimaryVideo(),
      onVideoReady: () => {
        this.updatePrimaryVideo()
        this.scheduleRender()
      },
      onVideoSeeked: () => this.scheduleRender(),
      onVideoTimeUpdate: () => {
        if (!this.playing) this.scheduleRender()
      },
      onVideoError: (reason) => this.fail(reason),
    })
    this.layerRenderer = new WebGpuLayerRenderer({
      getDevice: () => this.device,
      getSampler: () => this.sampler,
      getBindGroupLayout: () => this.bindGroupLayout,
      pipelineFor: (blendMode) => this.pipelineFor(blendMode),
    }, this.resources)
    // WebGPU captures the canvas size when its context is created. Resize the
    // backing store before the asynchronous adapter/device setup begins.
    this.syncCanvasBackingSize()
    logger.info('[WebGPU诊断] 渲染器创建', {
      projectSize: { width: options.canvasWidth, height: options.canvasHeight },
      maxSide: options.maxSide,
      dpr: window.devicePixelRatio,
      canvas: this.canvasSnapshot(),
    })
  }


  async initialize(): Promise<void> {
    logger.info('[WebGPU诊断] 初始化开始', {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      dpr: window.devicePixelRatio,
      navigatorGpu: Boolean(getWebGpuNavigator()),
      canvas: this.canvasSnapshot(),
    })
    try {
      const gpu = getWebGpuNavigator()
      if (!gpu) {
        logger.warn('[WebGPU诊断] navigator.gpu 不存在')
        throw new Error('当前版本没有可用的 WebGPU 画面加速能力')
      }
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) {
        logger.warn('[WebGPU诊断] requestAdapter 未返回可用设备')
        throw new Error('当前设备没有可用的 WebGPU 画面加速设备')
      }
      logger.info('[WebGPU诊断] WebGPU adapter 获取成功')
      const device = await adapter.requestDevice()
      logger.info('[WebGPU诊断] WebGPU device 获取成功')
      this.syncCanvasBackingSize()
      const context = getWebGpuContext(this.canvas)
      if (!context) {
        logger.warn('[WebGPU诊断] webgpu 画布上下文创建失败')
        throw new Error('当前窗口无法创建 WebGPU 画布')
      }
      this.device = device
      this.context = context
      this.presentationFormat = gpu.getPreferredCanvasFormat()
      // The compositor shader operates in linear light. Keep its offscreen
      // targets sRGB so the render pass encodes the result before the raw bytes
      // are copied into the browser-owned canvas texture. The unorm and
      // unorm-srgb variants are copy-compatible because they have the same
      // underlying 8-bit layout.
      this.canvasFormat = this.options.captureFormat === 'rgba'
        ? 'rgba8unorm-srgb'
        : srgbFormatFor(this.presentationFormat)
      this.configureCanvasContext()
      logger.info('[WebGPU诊断] 画布已配置', {
        presentationFormat: this.presentationFormat,
        renderFormat: this.canvasFormat,
        canvas: this.canvasSnapshot(),
      })
      this.createGpuObjects()
      const compilationInfo = await this.shader?.getCompilationInfo?.()
      const compilationErrors = compilationInfo?.messages?.filter((message) => message.type === 'error') ?? []
      if (compilationErrors.length > 0) {
        const detail = compilationErrors[0]
        throw new Error(`WebGPU 画面着色器不可用${detail.message ? `: ${detail.message}` : ''}`)
      }
      this.initialized = true
      logger.info('[WebGPU诊断] 初始化完成', { canvas: this.canvasSnapshot() })
      void device.lost.then((info) => {
        if (this.destroyed) return
        logger.error('[WebGPU诊断] device.lost', {
          reason: info.reason ?? 'unknown',
          message: info.message ?? '',
          canvas: this.canvasSnapshot(),
        })
        this.fail(`WebGPU 设备已停止工作${info.message ? `: ${info.message}` : ''}`)
      })
    } catch (error) {
      logger.error('[WebGPU诊断] 初始化失败', {
        error: error instanceof Error ? error.message : String(error),
        canvas: this.canvasSnapshot(),
      })
      throw error
    }
  }

  resize(): void {
    if (this.destroyed || this.failed || !this.initialized || !this.context) return
    if (this.renderInFlight) {
      this.resizeQueued = true
      return
    }
    const before = this.canvasSnapshot()
    if (!this.syncCanvasBackingSize()) return
    const after = this.canvasSnapshot()
    logger.info('[WebGPU诊断] 画布尺寸变化', { before, after })
    this.configureCanvasContext()
    this.outputTexture?.texture.destroy?.()
    this.outputTexture = null
    this.renderRevision += 1
    this.scheduleRender()
  }

  /** Update the project backing size without recreating the renderer. */
  setRenderSize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.round(width))
    const nextHeight = Math.max(1, Math.round(height))
    if (nextWidth === this.canvasWidth && nextHeight === this.canvasHeight) return
    this.canvasWidth = nextWidth
    this.canvasHeight = nextHeight
    if (this.initialized) this.resize()
    else this.syncCanvasBackingSize()
  }

  /** Rebuild source textures when the preview quality changes. */
  setMaxSide(maxSide: number): void {
    const nextMaxSide = Math.max(1, Math.round(maxSide))
    if (nextMaxSide === this.options.maxSide) return
    this.options.maxSide = nextMaxSide
    this.renderRevision += 1
    if (this.renderInFlight) {
      this.imageResourcesInvalidated = true
      this.renderQueued = true
      return
    }
    this.resources.clearImageResources()
    this.scheduleRender()
  }

  async setLayers(layers: PreviewLayer[]): Promise<void> {
    if (!this.initialized || this.destroyed || this.failed) return
    const playbackLayerSignature = layers
      .filter((layer) => layer.isVideo)
      .map((layer) => `${videoLayerKey(layer)}:${numberOr(layer.videoTime, 0)}:${numberOr(layer.videoOffset, 0)}`)
      .join('|')
    const playbackTimelineChanged = playbackLayerSignature !== this.playbackLayerSignature
    this.playbackLayerSignature = playbackLayerSignature
    this.layers = layers
    if (this.active && this.playing && playbackTimelineChanged) {
      this.playbackStartCompositionTime = this.compositionTime
    }
    const summary = layers.map((layer) => `${layer.layerType ?? 'media'}:${layer.isVideo ? 'video' : 'still'}:${layer.dstW}x${layer.dstH}`).join('|')
    if (summary !== this.lastLayerSummary) {
      this.lastLayerSummary = summary
      logger.info('[WebGPU诊断] 图层已同步', { count: layers.length, summary })
    }
    this.renderRevision += 1
    await this.resources.syncVideoElements(this.layers)
    if (!this.destroyed) this.scheduleRender()
  }

  async setPlayback(active: boolean, playing: boolean, time: number): Promise<void> {
    if (this.destroyed || this.failed) return
    const wasPlaying = this.active && this.playing
    this.active = active
    this.playing = playing
    this.compositionTime = Math.max(0, Number.isFinite(time) ? time : 0)
    if (playing && active && !wasPlaying) this.playbackStartCompositionTime = this.compositionTime
    if (!playing || !active) this.playbackStartCompositionTime = null
    for (const entry of this.resources.videoEntries) {
      if (!entry.ready) continue
      if (playing && active) await entry.video.play().catch(() => undefined)
      else entry.video.pause()
    }
    if (playing && active) this.schedulePlaybackLoop()
    else this.cancelPlaybackLoop()
    this.scheduleRender()
  }

  /** 导出专用的确定性逐帧渲染。 */
  async renderFrameAt(time: number, options: { seekVideos?: boolean } = {}): Promise<void> {
    if (this.destroyed || this.failed || !this.initialized) {
      throw new Error(this.lastFailureReason || 'WebGPU 渲染器尚未准备好')
    }
    const compositionTime = Math.max(0, Number.isFinite(time) ? time : 0)
    this.active = true
    this.playing = false
    this.compositionTime = compositionTime
    const exportFrame = this.exportFrameCounter + 1
    this.exportFrameCounter = exportFrame
    const pendingVideoSeeks = new Map<HTMLVideoElement, PendingVideoSeek>()
    let deduplicatedVideoLayers = 0
    let conflictingVideoTargets = 0
    let firstVideoTargetConflict: { key: string; previousTime: number; finalTime: number } | null = null
    for (const layer of this.layers) {
      if (!layer.isVideo) continue
      const entry = this.resources.entryForLayer(layer)
      if (!entry) continue
      const sourceTime = numberOr(layer.videoTime, 0)
        + compositionTime
        - numberOr(layer.videoOffset, 0)
      const previous = pendingVideoSeeks.get(entry.video)
      if (previous) {
        deduplicatedVideoLayers += 1
        if (Math.abs(previous.sourceTime - sourceTime) >= 0.001) {
          conflictingVideoTargets += 1
          firstVideoTargetConflict ??= {
            key: entry.key,
            previousTime: previous.sourceTime,
            finalTime: sourceTime,
          }
        }
        if (firstVideoTargetConflict?.key === entry.key) firstVideoTargetConflict.finalTime = sourceTime
        // Keep the existing order-dependent behavior: the last layer wins.
        previous.sourceTime = sourceTime
      } else {
        pendingVideoSeeks.set(entry.video, { entry, sourceTime })
      }
    }
    const seekVideos = options.seekVideos !== false
    const seekStartedAt = performance.now()
    for (const { entry, sourceTime } of pendingVideoSeeks.values()) {
      if (!entry.ready) {
        await waitForVideoReady(entry.video)
        entry.ready = true
      }
      if (seekVideos) await seekVideo(entry.video, sourceTime)
      else await playAndWaitForVideoFrame(entry.video)
    }
    const seekMs = performance.now() - seekStartedAt
    if (this.destroyed || this.failed) throw new Error(this.lastFailureReason || 'WebGPU 渲染器已停止')
    this.renderRevision += 1
    if (firstVideoTargetConflict && exportFrame - this.lastVideoTargetConflictLogFrame >= 30) {
      this.lastVideoTargetConflictLogFrame = exportFrame
      logger.warn('[WebGPU诊断] 同一视频源出现多个导出目标时间，已使用最后一个目标时间', {
        exportFrame,
        key: firstVideoTargetConflict.key,
        previousTime: firstVideoTargetConflict.previousTime,
        finalTime: firstVideoTargetConflict.finalTime,
        conflictingVideoTargets,
      })
    }
    const rendered = this.waitForNextRender()
    const renderScheduleStartedAt = performance.now()
    if (this.renderFrameId) {
      cancelAnimationFrame(this.renderFrameId)
      this.renderFrameId = 0
    }
    if (this.renderInFlight) {
      this.renderQueued = true
      this.directRenderQueued = true
    } else {
      void this.render()
    }
    await rendered
    const renderScheduleMs = performance.now() - renderScheduleStartedAt
    if (exportFrame === 1 || exportFrame % 30 === 0) {
      logger.info('[WebGPU诊断] 导出帧渲染', {
        exportFrame,
        uniqueVideoSources: pendingVideoSeeks.size,
        deduplicatedVideoLayers,
        seekVideos,
        seekMs: Math.round(seekMs * 100) / 100,
        renderScheduleMs: Math.round(renderScheduleMs * 100) / 100,
      })
    }
  }

  /**
   * Read the final compositor texture as RGBA for WebCodecs. Chromium's
   * direct VideoFrame(WebGPU canvas) path is not reliable on every backend;
   * this explicit boundary also makes the captured frame deterministic.
   */
  async readOutputFrame(): Promise<{ rgba: Uint8Array; width: number; height: number }> {
    const device = this.device
    const output = this.outputTexture
    if (!device || !output) throw new Error('WebGPU 输出画面尚未准备好')
    return readWebGpuOutputFrame(device, output, this.canvasFormat)
  }


  async captureVideoFrame<T>(createFrame: (rgba: Uint8Array, width: number, height: number) => T): Promise<T> {
    const output = await this.readOutputFrame()
    return createFrame(output.rgba, output.width, output.height)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.rejectRenderWaiters(new Error('WebGPU 渲染器已销毁'))
    if (this.renderFrameId) cancelAnimationFrame(this.renderFrameId)
    this.cancelPlaybackLoop()
    this.resources.destroy()
    this.layerRenderer.destroy()
    for (const resource of this.precompositions.values()) resource.texture.destroy?.()
    this.precompositions.clear()
    this.outputTexture?.texture.destroy?.()
    this.outputTexture = null
    this.options.onVideoElement(null)
  }


  private createGpuObjects(): void {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    this.shader = device.createShaderModule({ code: WEBGPU_COMPOSITOR_SHADER })
    this.bindGroupLayout = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', hasDynamicOffset: false, minBindingSize: PARAM_FLOAT_COUNT * 4 } },
      { binding: 3, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d', multisampled: false } },
      { binding: 4, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 5, visibility: 2, texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
      { binding: 6, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d', multisampled: false } },
    ] })
    this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] })
    this.sampler = device.createSampler({ addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'nearest' })
    this.resources.setDevice(device)
    this.resources.createDefaultResources()
  }


  private configureCanvasContext(): void {
    const device = this.device
    const context = this.context
    if (!device || !context) throw new Error('WebGPU 画布尚未初始化')
    context.configure({
      device,
      format: this.presentationFormat,
      colorSpace: 'srgb',
      usage: TEXTURE_USAGE_COPY_DST | TEXTURE_USAGE_RENDER_ATTACHMENT,
      alphaMode: 'premultiplied',
    })
  }

  private canvasSnapshot(): {
    cssWidth: number
    cssHeight: number
    backingWidth: number
    backingHeight: number
    projectWidth: number
    projectHeight: number
  } {
    const rect = 'getBoundingClientRect' in this.canvas
      ? this.canvas.getBoundingClientRect()
      : { width: this.canvas.width, height: this.canvas.height }
    return {
      cssWidth: Math.round(rect.width * 100) / 100,
      cssHeight: Math.round(rect.height * 100) / 100,
      backingWidth: this.canvas.width,
      backingHeight: this.canvas.height,
      projectWidth: this.renderWidth,
      projectHeight: this.renderHeight,
    }
  }

  private syncCanvasBackingSize(): boolean {
    // The preview canvas deliberately keeps the project resolution as its
    // backing store while CSS scales it to fit the workspace. Do not use the
    // transformed/client box here: it is a display size, not a render target.
    const width = this.canvasWidth
    const height = this.canvasHeight
    const changed = this.canvas.width !== width || this.canvas.height !== height
    if (changed) {
      this.canvas.width = width
      this.canvas.height = height
    }
    const renderSizeChanged = this.renderWidth !== width || this.renderHeight !== height
    this.renderWidth = width
    this.renderHeight = height
    return changed || renderSizeChanged
  }

  private pipelineFor(blendMode: PreviewLayer['blendMode']): GpuPipeline {
    const device = this.device
    if (!device || !this.shader || !this.pipelineLayout) throw new Error('WebGPU 管线未初始化')
    const key = blendMode ?? 'normal'
    const cached = this.pipelines.get(key)
    if (cached) return cached
    const alpha = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
    const color = key === 'multiply'
      ? { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }
      : key === 'screen'
        ? { srcFactor: 'one', dstFactor: 'one-minus-src', operation: 'add' }
        : key === 'add'
          ? { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
          : alpha
    const pipeline = device.createRenderPipeline({
      layout: this.pipelineLayout,
      vertex: { module: this.shader, entryPoint: 'vs_main' },
      fragment: { module: this.shader, entryPoint: 'fs_main', targets: [{ format: this.canvasFormat, blend: { color, alpha }, writeMask: 0xF }] },
      primitive: { topology: 'triangle-strip' },
    })
    this.pipelines.set(key, pipeline)
    return pipeline
  }

  private schedulePlaybackLoop(): void {
    if (this.destroyed || this.failed || !this.playing || !this.active || this.playbackFrameId) return
    this.playbackFrameId = requestAnimationFrame((timestamp) => {
      this.playbackFrameId = 0
      if (timestamp - this.lastPlaybackRenderAt >= 1000 / 30) {
        this.lastPlaybackRenderAt = timestamp
        this.scheduleRender()
      }
      this.schedulePlaybackLoop()
    })
  }

  private cancelPlaybackLoop(): void {
    if (this.playbackFrameId) {
      cancelAnimationFrame(this.playbackFrameId)
      this.playbackFrameId = 0
    }
    this.lastPlaybackRenderAt = -Infinity
  }

  private scheduleRender(): void {
    if (this.destroyed || this.failed || this.renderFrameId) return
    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = 0
      void this.render()
    })
  }

  private waitForNextRender(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.renderWaiters.add({ resolve, reject })
    })
  }

  private resolveRenderWaiters(): void {
    const waiters = [...this.renderWaiters]
    this.renderWaiters.clear()
    for (const waiter of waiters) waiter.resolve()
  }

  private rejectRenderWaiters(error: Error): void {
    const waiters = [...this.renderWaiters]
    this.renderWaiters.clear()
    for (const waiter of waiters) waiter.reject(error)
  }

  private fail(reason: string): void {
    if (this.destroyed) return
    if (this.lastFailureReason === reason) return
    this.lastFailureReason = reason
    this.failed = true
    logger.error('[WebGPU诊断] 预览失败，已停止继续提交帧', { reason, canvas: this.canvasSnapshot() })
    this.options.onError(reason)
  }


  private updatePrimaryVideo(): void {
    const primaryLayer = this.layers.find((layer) => layer.isVideo)
    const primary = primaryLayer ? this.resources.entryForLayer(primaryLayer)?.video ?? null : null
    if (primary === this.currentPrimaryVideo) return
    this.currentPrimaryVideo = primary
    this.options.onVideoElement(primary)
  }

  private currentPlaybackCompositionTime(): number {
    const primaryLayer = this.layers.find((layer) => layer.isVideo)
    const primaryVideo = primaryLayer
      ? this.resources.entryForLayer(primaryLayer)?.video
      : undefined
    if (!this.playing || !primaryLayer || !primaryVideo || !Number.isFinite(primaryVideo.currentTime)) {
      return this.compositionTime
    }
    return Math.max(
      0,
      primaryVideo.currentTime
        - numberOr(primaryLayer.videoTime, 0)
        + numberOr(primaryLayer.videoOffset, 0),
    )
  }

  private syncVideoClocks(): void {
    const playbackTime = this.playbackStartCompositionTime ?? this.currentPlaybackCompositionTime()
    if (this.playing) this.compositionTime = playbackTime
    let primaryVideoReady = false
    for (const layer of this.layers) {
      if (!layer.isVideo) continue
      const entry = this.resources.entryForLayer(layer)
      if (!entry?.ready) continue
      if (entry.video === this.currentPrimaryVideo) primaryVideoReady = true
      // 播放时主视频自身就是时钟，不能用低频的 React timeupdate 反向拉回它。
      // 其他视频层仍跟随主视频的合成时间，避免多视频素材逐渐漂移。
      if (this.playing && entry.video === this.currentPrimaryVideo && this.playbackStartCompositionTime === null) continue
      const target = Math.max(0, numberOr(layer.videoTime, 0) + playbackTime - numberOr(layer.videoOffset, 0))
      const threshold = this.playing ? 0.15 : 0.01
      if (Math.abs(entry.video.currentTime - target) > threshold) entry.video.currentTime = target
    }
    if (this.playbackStartCompositionTime !== null && primaryVideoReady) {
      this.playbackStartCompositionTime = null
    }
  }



  private outputResource(width: number, height: number): GpuImageResource {
    const device = this.device
    if (!device) throw new Error('WebGPU 设备未初始化')
    if (this.outputTexture?.width === width && this.outputTexture.height === height) return this.outputTexture
    this.outputTexture?.texture.destroy?.()
    const texture = createTexture(
      device,
      width,
      height,
      this.canvasFormat,
      TEXTURE_USAGE_COPY_SRC | TEXTURE_USAGE_RENDER_ATTACHMENT,
    )
    this.outputTexture = { texture, width, height }
    return this.outputTexture
  }

  private async render(): Promise<void> {
    if (this.destroyed || this.failed || !this.initialized || !this.active) return
    const context = this.context
    const device = this.device
    if (!device) return
    if (this.renderInFlight) {
      this.renderQueued = true
      return
    }
    this.renderInFlight = true
    this.renderQueued = false
    this.frameCounter += 1
    const revision = this.renderRevision
    const currentLayers = this.layers
    try {
      this.syncVideoClocks()
      const groups = new Map<string, PreviewLayer[]>()
      for (const layer of currentLayers) {
        if (layer.precomposeRole !== 'input' || !layer.precomposeGroup) continue
        const group = groups.get(layer.precomposeGroup) ?? []
        group.push(layer)
        groups.set(layer.precomposeGroup, group)
      }
      const overrides = new Map<string, GpuImageResource>()
      const skippedGroups = new Set<string>()
      for (const [group, groupLayers] of groups) {
        if (groupLayers.some((layer) => layer.isVideo && !this.resources.hasReadyVideo(layer))) {
          skippedGroups.add(group)
          continue
        }
        await this.resources.resourceForLayer(groupLayers[0], new Map(), this.renderWidth, this.renderHeight)
        const targetWidth = this.renderWidth
        const targetHeight = this.renderHeight
        let target = this.precompositions.get(group)
        if (!target || target.width !== targetWidth || target.height !== targetHeight) {
          target?.texture.destroy?.()
          const texture = createTexture(
            this.device!,
            targetWidth,
            targetHeight,
            this.canvasFormat,
            TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT,
          )
          target = { texture, width: targetWidth, height: targetHeight }
          this.precompositions.set(group, target)
        }
        await this.layerRenderer.drawLayers(groupLayers, target.texture.createView(), target.width, target.height, this.compositionTime, new Map())
        overrides.set(group, target)
      }
      if (revision !== this.renderRevision || this.destroyed) return
      const outputLayers = currentLayers.filter((layer) => (
        layer.precomposeRole !== 'input'
        && !(layer.precomposeRole === 'output' && layer.precomposeGroup && skippedGroups.has(layer.precomposeGroup))
      ))
      const output = this.outputResource(this.renderWidth, this.renderHeight)
      await this.layerRenderer.drawLayers(
        outputLayers,
        output.texture.createView(),
        output.width,
        output.height,
        this.compositionTime,
        overrides,
      )
      if (revision !== this.renderRevision || this.destroyed) return
      if (this.options.presentToCanvas !== false) {
        if (!context) throw new Error('WebGPU 画布上下文尚未初始化')
        const presentationTexture = context.getCurrentTexture()
        const copyEncoder = device.createCommandEncoder({ label: 'luna-webgpu-present' })
        copyEncoder.copyTextureToTexture(
          { texture: output.texture },
          { texture: presentationTexture },
          { width: output.width, height: output.height, depthOrArrayLayers: 1 },
        )
        device.queue.submit([copyEncoder.finish()])
      }
      if (this.options.waitForGpu) await device.queue.onSubmittedWorkDone?.()
      if (!this.destroyed) {
        if (!this.firstRenderLogged) {
          this.firstRenderLogged = true
          logger.info('[WebGPU诊断] 首帧渲染完成', {
            canvas: this.canvasSnapshot(),
            layerCount: currentLayers.length,
            presentationFormat: this.presentationFormat,
          })
        }
        this.options.onRender()
        this.resolveRenderWaiters()
      }
    } catch (error: unknown) {
      if (!this.destroyed) {
        const reason = error instanceof Error ? error.message : String(error)
        this.rejectRenderWaiters(error instanceof Error ? error : new Error(reason))
        this.fail(reason)
      }
    } finally {
      this.renderInFlight = false
      if (this.imageResourcesInvalidated) {
        this.imageResourcesInvalidated = false
        this.resources.clearImageResources()
      }
      if (this.resizeQueued && !this.destroyed) {
        this.resizeQueued = false
        this.resize()
      }
      if (this.renderQueued && !this.destroyed) {
        this.renderQueued = false
        const renderImmediately = this.directRenderQueued
        this.directRenderQueued = false
        if (renderImmediately) void this.render()
        else this.scheduleRender()
      }
    }
  }



}
