import { WebGpuVideoRenderer } from '../src/components/webgpuVideoRenderer'
import type { PreviewLayer } from '../src/shared/types'

interface ComparisonFeature {
  id: string
  layers: PreviewLayer[]
  time: number
}

interface ComparisonConfig {
  canvasWidth: number
  canvasHeight: number
  maxSide: number
  lutText: string
  fontPath: string
  fontData: string
  mask: { width: number; height: number; bytes: number[] }
  features: ComparisonFeature[]
  waitForGpu?: boolean
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

interface ComparisonApi {
  initialize(config: ComparisonConfig): Promise<{ navigatorGpu: boolean }>
  renderFeature(id: string): Promise<{ elapsedMs: number; layerCount: number }>
  measureVideo(id: string, durationMs: number): Promise<VideoBenchmarkResult>
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
    loadLut: async () => new TextEncoder().encode(next.lutText).buffer,
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
  async initialize(next: ComparisonConfig): Promise<{ navigatorGpu: boolean }> {
    if (renderer) throw new Error('WebGPU standalone renderer already initialized')
    config = next
    canvas.width = next.canvasWidth
    canvas.height = next.canvasHeight
    installStandaloneApi(next)
    renderer = new WebGpuVideoRenderer(canvas, {
      canvasWidth: next.canvasWidth,
      canvasHeight: next.canvasHeight,
      maxSide: next.maxSide,
      waitForGpu: next.waitForGpu ?? true,
      rasterizeImages: true,
      onVideoElement: (element) => {
        primaryVideo = element instanceof HTMLVideoElement ? element : null
      },
      onFallback: (reason) => {
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
    return { navigatorGpu: 'gpu' in navigator }
  },

  async renderFeature(id: string): Promise<{ elapsedMs: number; layerCount: number }> {
    if (!renderer || !config) throw new Error('WebGPU standalone renderer is not initialized')
    const feature = config.features.find((entry) => entry.id === id)
    if (!feature) throw new Error(`Unknown comparison feature: ${id}`)
    const startedAt = performance.now()
    const rendered = waitForRender()
    await renderer.setLayers(feature.layers)
    await renderer.setPlayback(true, false, feature.time)
    await rendered
    // Resource uploads schedule a follow-up frame; wait for the settled frame.
    const settled = waitForRender()
    await renderer.setPlayback(true, false, feature.time)
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
