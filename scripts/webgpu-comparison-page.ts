import { WebGpuVideoRenderer } from '../src/components/webgpuVideoRenderer'
import type { PreviewLayer } from '../src/shared/types'

interface ComparisonFeature {
  id: string
  layers: PreviewLayer[]
  time: number
  frameLayers?: PreviewLayer[][]
}

interface ComparisonConfig {
  canvasWidth: number
  canvasHeight: number
  presentationWidth?: number
  presentationHeight?: number
  maxSide: number
  lutText: string
  lutTexts?: Record<string, string>
  fontPath: string
  fontData: string
  mask: { width: number; height: number; bytes: number[] }
  features: ComparisonFeature[]
  hdrPresentation?: boolean
  waitForGpu?: boolean
  captureMode?: 'canvas' | 'readback'
}

interface VideoQualitySnapshot {
  totalVideoFrames: number | null
  droppedVideoFrames: number | null
  corruptedVideoFrames: number | null
}

interface VideoBenchmarkResult {
  elapsedMs: number
  rendererFrames: number
  videoFrameCallbacks: number
  presentedFrames: number | null
  renderTimes: number[]
  videoFrameTimes: number[]
  firstRenderMs: number | null
  qualityBefore: VideoQualitySnapshot
  qualityAfter: VideoQualitySnapshot
  video: { width: number; height: number; duration: number }
}

interface EncodedVideoChunkLike {
  type: 'key' | 'delta'
  timestamp: number
  duration?: number
  byteLength: number
  copyTo(destination: Uint8Array): void
}

interface VideoFrameLike {
  close(): void
  allocationSize?(options?: Record<string, unknown>): number
  copyTo?(destination: Uint8Array, options?: Record<string, unknown>): Promise<unknown>
}

interface VideoEncoderLike {
  readonly encodeQueueSize?: number
  configure(config: Record<string, unknown>): void
  encode(frame: VideoFrameLike, options?: Record<string, unknown>): void
  flush(): Promise<void>
  close(): void
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        window.clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

interface VideoEncoderConstructorLike {
  new(options: {
    output: (chunk: EncodedVideoChunkLike) => void
    error: (error: Error) => void
  }): VideoEncoderLike
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean; config?: Record<string, unknown> }>
}

interface VideoFrameConstructorLike {
  new(source: unknown, init: {
    format: 'RGBA'
    codedWidth: number
    codedHeight: number
    timestamp: number
    duration?: number
  }): VideoFrameLike
}

interface WebCodecsExportChunk {
  type: 'key' | 'delta'
  timestamp: number
  duration: number | null
  data: number[]
}

interface WebCodecsExportResult {
  elapsedMs: number
  renderMs: number
  encodeMs: number
  captureMs: number
  readbackMs: number
  flushMs: number
  frames: number
  keyFrames: number
  chunks: WebCodecsExportChunk[]
  codec: string
  width: number
  height: number
  fps: number
  capturePath: string
}

const MAX_IN_FLIGHT_CAPTURES = 2

async function hasCanvasVideoFramePixels(frame: VideoFrameLike, width: number, height: number): Promise<boolean> {
  if (!frame.allocationSize || !frame.copyTo) return false
  const sampleSize = 16
  const rects = [
    { x: 0, y: 0 },
    { x: Math.max(0, Math.floor(width / 2) - sampleSize / 2), y: Math.max(0, Math.floor(height / 2) - sampleSize / 2) },
    { x: Math.max(0, width - sampleSize), y: Math.max(0, height - sampleSize) },
  ].map(({ x, y }) => ({
    x: Math.min(Math.max(0, Math.floor(x)), Math.max(0, width - sampleSize)),
    y: Math.min(Math.max(0, Math.floor(y)), Math.max(0, height - sampleSize)),
    width: Math.min(sampleSize, width),
    height: Math.min(sampleSize, height),
  }))
  try {
    for (const rect of rects) {
      const options = { format: 'RGBA', rect }
      const pixels = new Uint8Array(frame.allocationSize(options))
      await frame.copyTo(pixels, options)
      if (pixels.some((value) => value !== 0)) return true
    }
  } catch {
    return false
  }
  return false
}

interface ComparisonApi {
  initialize(config: ComparisonConfig): Promise<{ navigatorGpu: boolean; hdrPresentationEnabled: boolean }>
  renderFeature(id: string, playing?: boolean): Promise<{ elapsedMs: number; layerCount: number }>
  measureVideo(id: string, durationMs: number): Promise<VideoBenchmarkResult>
  exportVideo(id: string, frameCount: number, fps: number, codec: string, bitrate: number): Promise<WebCodecsExportResult>
  destroy(): void
}

interface ComparisonWindow extends Window {
  lunaWebGpuComparison?: ComparisonApi
}

const pageWindow = window as ComparisonWindow
const canvas = document.querySelector<HTMLCanvasElement>('#comparison-canvas')
if (!canvas) throw new Error('comparison canvas is missing')

let renderer: WebGpuVideoRenderer | null = null
let config: ComparisonConfig | null = null
let pendingRender: { target: number; resolve: () => void; reject: (error: Error) => void } | null = null
let primaryVideo: HTMLVideoElement | null = null
let benchmarkStartedAt: number | null = null
let benchmarkRenderTimes: number[] = []
let renderCount = 0
let lastFallbackReason: string | null = null

function rejectPending(error: unknown): void {
  const current = pendingRender
  pendingRender = null
  current?.reject(error instanceof Error ? error : new Error(String(error)))
}

function waitForRender(): Promise<void> {
  const target = renderCount + 1
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingRender = null
      reject(new Error(`WebGPU standalone render timed out (renders=${renderCount}, fallback=${lastFallbackReason ?? 'none'})`))
    }, 15_000)
    pendingRender = {
      target,
      resolve: () => {
        window.clearTimeout(timeout)
        pendingRender = null
        resolve()
      },
      reject: (error) => {
        window.clearTimeout(timeout)
        pendingRender = null
        reject(error)
      },
    }
  })
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('WebGPU standalone video did not become ready'))
    }, 15_000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.removeEventListener('loadeddata', handleReady)
      video.removeEventListener('error', handleError)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`WebGPU standalone video failed to load: ${video.error?.message ?? 'unknown error'}`))
    }
    video.addEventListener('loadeddata', handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
  })
}

function waitForAnimationFrames(count: number): Promise<void> {
  if (count <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      void waitForAnimationFrames(count - 1).then(resolve)
    })
  })
}

function videoQuality(video: HTMLVideoElement): VideoQualitySnapshot {
  const quality = (video as HTMLVideoElement & {
    getVideoPlaybackQuality?: () => { totalVideoFrames?: number; droppedVideoFrames?: number; corruptedVideoFrames?: number }
  }).getVideoPlaybackQuality?.()
  return {
    totalVideoFrames: typeof quality?.totalVideoFrames === 'number' ? quality.totalVideoFrames : null,
    droppedVideoFrames: typeof quality?.droppedVideoFrames === 'number' ? quality.droppedVideoFrames : null,
    corruptedVideoFrames: typeof quality?.corruptedVideoFrames === 'number' ? quality.corruptedVideoFrames : null,
  }
}

function installStandaloneApi(next: ComparisonConfig): void {
  let fontBytes: ArrayBuffer | null = null
  const workspace = {
    loadLut: async (filePath: string) => new TextEncoder().encode(next.lutTexts?.[filePath] ?? next.lutText).buffer,
    loadFont: async (filePath: string) => {
      if (filePath !== next.fontPath) throw new Error(`standalone font fixture is missing: ${filePath}`)
      if (!fontBytes) {
        const binary = atob(next.fontData)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
        fontBytes = bytes.buffer
      }
      return fontBytes.slice(0)
    },
    loadColorMask: async () => ({
      width: next.mask.width,
      height: next.mask.height,
      bytes: new Uint8Array(next.mask.bytes).buffer,
    }),
  }
  ;(window as Window & { luna?: { workspace: typeof workspace } }).luna = { workspace }
}

pageWindow.lunaWebGpuComparison = {
  async initialize(next: ComparisonConfig): Promise<{ navigatorGpu: boolean; hdrPresentationEnabled: boolean }> {
    if (renderer) throw new Error('WebGPU standalone renderer already initialized')
    config = next
    const presentationWidth = next.presentationWidth ?? next.canvasWidth
    const presentationHeight = next.presentationHeight ?? next.canvasHeight
    canvas.style.width = `${presentationWidth}px`
    canvas.style.height = `${presentationHeight}px`
    canvas.width = presentationWidth
    canvas.height = presentationHeight
    installStandaloneApi(next)
    renderer = new WebGpuVideoRenderer(canvas, {
      canvasWidth: next.canvasWidth,
      canvasHeight: next.canvasHeight,
      maxSide: next.maxSide,
      hdrPresentation: next.hdrPresentation,
      // Canvas VideoFrame capture is the synchronization point for export.
      // Interactive preview leaves this disabled unless explicitly requested.
      waitForGpu: next.captureMode === 'canvas' ? true : next.waitForGpu ?? false,
      rasterizeImages: true,
      onVideoElement: (element) => {
        primaryVideo = element instanceof HTMLVideoElement ? element : null
      },
      onError: (reason) => {
        lastFallbackReason = reason
        rejectPending(new Error(reason))
      },
      onRender: () => {
        renderCount += 1
        if (benchmarkStartedAt !== null) benchmarkRenderTimes.push(performance.now())
        if (pendingRender && renderCount >= pendingRender.target) pendingRender.resolve()
      },
    })
    await renderer.initialize()
    return { navigatorGpu: 'gpu' in navigator, hdrPresentationEnabled: renderer.isHdrPresentationEnabled() }
  },

  async renderFeature(id: string, playing = false): Promise<{ elapsedMs: number; layerCount: number }> {
    if (!renderer || !config) throw new Error('WebGPU standalone renderer is not initialized')
    const feature = config.features.find((entry) => entry.id === id)
    if (!feature) throw new Error(`Unknown comparison feature: ${id}`)
    const startedAt = performance.now()
    const rendered = waitForRender()
    await renderer.setLayers(feature.layers)
    await renderer.setPlayback(true, playing, feature.time)
    await rendered
    // Resource uploads schedule a follow-up frame; wait for the settled frame.
    const settled = waitForRender()
    await renderer.setPlayback(true, playing, feature.time)
    await settled
    // Let the browser complete the submitted GPU work before Playwright captures the canvas.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    return { elapsedMs: Math.round(performance.now() - startedAt), layerCount: feature.layers.length }
  },

  async measureVideo(id: string, durationMs: number): Promise<VideoBenchmarkResult> {
    if (!renderer || !config) throw new Error('WebGPU standalone renderer is not initialized')
    const feature = config.features.find((entry) => entry.id === id)
    if (!feature) throw new Error(`Unknown comparison feature: ${id}`)
    const firstRender = waitForRender()
    await renderer.setLayers(feature.layers)
    await firstRender
    const video = primaryVideo
    if (!video) throw new Error('WebGPU standalone video element is missing')
    await waitForVideoReady(video)

    await renderer.setPlayback(false, false, 0)
    await waitForAnimationFrames(2)
    video.pause()
    if (video.currentTime !== 0) {
      const seeked = new Promise<void>((resolve) => {
        video.addEventListener('seeked', () => resolve(), { once: true })
      })
      video.currentTime = 0
      await seeked
    }

    const qualityBefore = videoQuality(video)
    const renderTimes: number[] = []
    const videoFrameTimes: number[] = []
    let presentedFrames: number | null = null
    let running = true
    let frameCallbackId: number | null = null
    const videoWithFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: { presentedFrames?: number; mediaTime?: number }) => void) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const collectVideoFrame = (now: number, metadata: { presentedFrames?: number; mediaTime?: number }) => {
      if (!running) return
      videoFrameTimes.push(now)
      if (typeof metadata.presentedFrames === 'number') presentedFrames = metadata.presentedFrames
      if (frameCallbackId !== null && videoWithFrameCallback.requestVideoFrameCallback) {
        frameCallbackId = videoWithFrameCallback.requestVideoFrameCallback(collectVideoFrame)
      }
    }
    const startedAt = performance.now()
    benchmarkRenderTimes = renderTimes
    benchmarkStartedAt = startedAt
    if (videoWithFrameCallback.requestVideoFrameCallback) {
      frameCallbackId = videoWithFrameCallback.requestVideoFrameCallback(collectVideoFrame)
    }
    await renderer.setPlayback(true, true, 0)
    const clockTimer = window.setInterval(() => {
      void renderer?.setPlayback(true, true, video.currentTime).catch((error: unknown) => {
        rejectPending(error)
      })
    }, 100)
    await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(100, durationMs)))
    const endedAt = performance.now()
    running = false
    benchmarkStartedAt = null
    window.clearInterval(clockTimer)
    if (frameCallbackId !== null) videoWithFrameCallback.cancelVideoFrameCallback?.(frameCallbackId)
    await renderer.setPlayback(false, false, video.currentTime)
    const qualityAfter = videoQuality(video)
    const renderSample = [...benchmarkRenderTimes]
    benchmarkRenderTimes = []
    return {
      elapsedMs: Math.round(endedAt - startedAt),
      rendererFrames: renderSample.length,
      videoFrameCallbacks: videoFrameTimes.length,
      presentedFrames,
      renderTimes: renderSample.map((time) => Math.round((time - startedAt) * 100) / 100),
      videoFrameTimes: videoFrameTimes.map((time) => Math.round((time - startedAt) * 100) / 100),
      firstRenderMs: renderSample.length ? Math.round((renderSample[0] - startedAt) * 100) / 100 : null,
      qualityBefore,
      qualityAfter,
      video: {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      },
    }
  },

  async exportVideo(id: string, frameCount: number, fps: number, codec: string, bitrate: number): Promise<WebCodecsExportResult> {
    if (!renderer || !config) throw new Error('WebGPU standalone renderer is not initialized')
    const feature = config.features.find((entry) => entry.id === id)
    if (!feature) throw new Error(`Unknown comparison feature: ${id}`)
    const firstRender = waitForRender()
    await renderer.setLayers(feature.layers)
    await firstRender
    const globals = window as unknown as {
      VideoEncoder?: VideoEncoderConstructorLike
      VideoFrame?: VideoFrameConstructorLike
    }
    const Encoder = globals.VideoEncoder
    const Frame = globals.VideoFrame
    if (!Encoder || !Frame) throw new Error('当前 Chromium 不支持视频导出能力')
    const frameLayers = feature.frameLayers
    const video = primaryVideo
    if (!video && !frameLayers) throw new Error('WebGPU standalone export source is missing')
    if (video) {
      await waitForVideoReady(video)
      video.muted = true
      video.pause()
    }
    const safeFrameCount = Math.max(1, Math.min(60, Math.round(frameCount)))
    const safeFps = Math.max(1, Math.min(120, Number(fps) || 30))
    const safeBitrate = Math.max(100_000, Math.round(bitrate))
    const width = canvas.width
    const height = canvas.height
    const encoderConfig = {
      codec,
      width,
      height,
      bitrate: safeBitrate,
      framerate: safeFps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: { format: 'annexb' },
    }
    const support = await Encoder.isConfigSupported(encoderConfig)
    if (!support.supported) throw new Error(`当前 Chromium 不支持 ${codec} 视频编码`)
    const chunks: WebCodecsExportChunk[] = []
    let encodingError: Error | null = null
    const encoder = new Encoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        chunks.push({
          type: chunk.type,
          timestamp: chunk.timestamp,
          duration: typeof chunk.duration === 'number' ? chunk.duration : null,
          data: Array.from(data),
        })
      },
      error: (error) => {
        encodingError = error
      },
    })
    encoder.configure(support.config ?? encoderConfig)
    const startedAt = performance.now()
    let renderMs = 0
    let encodeMs = 0
    let captureMs = 0
    let directCapture = config.captureMode !== 'readback'
    let directCaptureFailureLogged = false
    const pendingCaptures: Array<{ index: number; promise: Promise<{ frame: VideoFrameLike; captureMs: number }> }> = []
    const captureCanvasFrame = async (index: number): Promise<{ frame: VideoFrameLike; captureMs: number }> => {
      const captureStartedAt = performance.now()
      const frameInit = {
        format: 'RGBA' as const,
        codedWidth: width,
        codedHeight: height,
        timestamp: Math.round(index * 1_000_000 / safeFps),
        duration: Math.round(1_000_000 / safeFps),
      }
      if (directCapture) {
        try {
          const frame = new Frame(canvas, frameInit)
          if (index === 0 && !(await hasCanvasVideoFramePixels(frame, width, height))) {
            frame.close()
            directCapture = false
            if (!directCaptureFailureLogged) {
              directCaptureFailureLogged = true
              console.warn('[WebGPU诊断] 画布直出 VideoFrame 内容无效，改用纹理读回', `${width}x${height}`)
            }
          } else {
            return { frame, captureMs: performance.now() - captureStartedAt }
          }
        } catch (error) {
          directCapture = false
          if (!directCaptureFailureLogged) {
            directCaptureFailureLogged = true
            console.warn('[WebGPU诊断] 画布直出 VideoFrame 不可用，改用纹理读回', String(error))
          }
        }
      }
      return renderer.captureVideoFrame((rgba, frameWidth, frameHeight) => ({
        frame: new Frame(rgba, {
          format: 'RGBA',
          codedWidth: frameWidth,
          codedHeight: frameHeight,
          timestamp: Math.round(index * 1_000_000 / safeFps),
          duration: Math.round(1_000_000 / safeFps),
        }),
        captureMs: performance.now() - captureStartedAt,
      }))
    }
    const encodeCanvasFrame = async (index: number, captured: { frame: VideoFrameLike; captureMs: number }): Promise<void> => {
      try {
        captureMs += captured.captureMs
        const encodeStartedAt = performance.now()
        encoder.encode(captured.frame, { keyFrame: index === 0 })
        encodeMs += performance.now() - encodeStartedAt
        const queueStartedAt = performance.now()
        while ((encoder.encodeQueueSize ?? 0) > 4) {
          if (encodingError) throw encodingError
          if (performance.now() - queueStartedAt >= 30_000) throw new Error('WebGPU standalone 编码队列排空超时')
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      } finally {
        captured.frame.close()
      }
    }
    const drainCapture = async (): Promise<void> => {
      const pending = pendingCaptures.shift()
      if (!pending) return
      await encodeCanvasFrame(pending.index, await pending.promise)
    }
    try {
      for (let index = 0; index < safeFrameCount; index += 1) {
        if (encodingError) throw encodingError
        const time = index / safeFps
        const renderStartedAt = performance.now()
        if (frameLayers) {
          const rendered = waitForRender()
          await renderer.setLayers(frameLayers[index] ?? frameLayers[frameLayers.length - 1] ?? feature.layers)
          await rendered
        } else if (video) {
          // Keep every benchmark frame tied to its requested media timestamp.
          // Capture/readback can be slower than realtime, so continuous
          // playback would make later frames skip ahead.
          await renderer.renderFrameAt(time, { seekVideos: true })
        }
        renderMs += performance.now() - renderStartedAt
        pendingCaptures.push({ index, promise: captureCanvasFrame(index) })
        if (pendingCaptures.length >= MAX_IN_FLIGHT_CAPTURES) await drainCapture()
      }
      while (pendingCaptures.length > 0) await drainCapture()
      const flushStartedAt = performance.now()
      await withTimeout(encoder.flush(), 15_000, 'WebCodecs 视频编码收尾超时')
      const flushMs = performance.now() - flushStartedAt
      if (encodingError) throw encodingError
      return {
        elapsedMs: Math.round(performance.now() - startedAt),
        renderMs: Math.round(renderMs * 100) / 100,
        encodeMs: Math.round(encodeMs * 100) / 100,
        captureMs: Math.round(captureMs * 100) / 100,
        readbackMs: Math.round(captureMs * 100) / 100,
        flushMs: Math.round(flushMs * 100) / 100,
        frames: safeFrameCount,
        keyFrames: chunks.filter((chunk) => chunk.type === 'key').length,
        chunks,
        codec,
        width,
        height,
        fps: safeFps,
        capturePath: directCapture ? 'webgpu-canvas-video-frame' : 'gpu-texture-readback-rgba-video-frame',
      }
    } finally {
      for (const pending of pendingCaptures.splice(0)) {
        void pending.promise
          .then((captured) => captured.frame.close())
          .catch(() => undefined)
      }
      encoder.close()
    }
  },

  destroy(): void {
    rejectPending(new Error('WebGPU standalone renderer destroyed'))
    renderer?.destroy()
    renderer = null
    config = null
    primaryVideo = null
    benchmarkStartedAt = null
    benchmarkRenderTimes = []
    renderCount = 0
    lastFallbackReason = null
  },
}
