import type { CompositionInput } from '../../shared/types'
import { WebGpuCompositionRenderer } from './composition'
import type { WebGpuRuntimeCapabilities } from './runtime'

export interface WebGpuEnvironmentCapabilities {
  navigatorGpu: boolean
  videoFrame: boolean
  videoDecoder: boolean
  videoEncoder: boolean
  worker: boolean
  offscreenCanvas: boolean
  workerWebGpuCandidate: boolean
}

export interface WebGpuFrameBenchmark {
  canvasWidth: number
  canvasHeight: number
  frameCount: number
  firstFrameMs: number
  averageFrameMs: number
  p95FrameMs: number
  minFrameMs: number
  maxFrameMs: number
  renderErrors: string[]
}

export interface WebGpuDiagnosticsSnapshot {
  version: 1
  createdAt: string
  environment: WebGpuEnvironmentCapabilities
  runtime: WebGpuRuntimeCapabilities
  initializeMs: number
  benchmark: WebGpuFrameBenchmark
  memory: {
    usedJsHeapSize?: number
    totalJsHeapSize?: number
    jsHeapSizeLimit?: number
  }
}

function supported(name: string): boolean {
  return typeof globalThis[name as keyof typeof globalThis] !== 'undefined'
}

function environmentCapabilities(): WebGpuEnvironmentCapabilities {
  const worker = supported('Worker')
  const offscreenCanvas = supported('OffscreenCanvas')
  return {
    navigatorGpu: typeof navigator !== 'undefined' && Boolean(navigator.gpu),
    videoFrame: supported('VideoFrame'),
    videoDecoder: supported('VideoDecoder'),
    videoEncoder: supported('VideoEncoder'),
    worker,
    offscreenCanvas,
    workerWebGpuCandidate: worker && offscreenCanvas && typeof navigator !== 'undefined' && Boolean(navigator.gpu),
  }
}

function benchmarkComposition(width: number, height: number): CompositionInput {
  return {
    canvas: { width, height, fps: 30 },
    layers: [{
      id: 'diagnostics-source',
      layerType: 'media',
      source: { path: 'webgpu-diagnostics-source', sourceType: 'image' },
      rect: { x: 0, y: 0, w: 1, h: 1 },
      sourceRect: { x: 0, y: 0, w: 1, h: 1 },
      fit: 'stretch',
      opacity: 1,
      zIndex: 0,
    }],
  }
}

function memorySnapshot(): WebGpuDiagnosticsSnapshot['memory'] {
  const memory = (performance as Performance & {
    memory?: {
      usedJSHeapSize: number
      totalJSHeapSize: number
      jsHeapSizeLimit: number
    }
  }).memory
  if (!memory) return {}
  return {
    usedJsHeapSize: memory.usedJSHeapSize,
    totalJsHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  }
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1))
  return sorted[index] ?? 0
}

function benchmarkSource(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建 WebGPU 基线源画布')
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#0066cc')
  gradient.addColorStop(1, '#f0a34a')
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  return canvas
}

export async function collectWebGpuDiagnostics(options: {
  width?: number
  height?: number
  frameCount?: number
} = {}): Promise<WebGpuDiagnosticsSnapshot> {
  const width = Math.max(1, Math.round(options.width ?? 640))
  const height = Math.max(1, Math.round(options.height ?? 360))
  const frameCount = Math.max(1, Math.round(options.frameCount ?? 30))
  const environment = environmentCapabilities()
  const canvas = document.createElement('canvas')
  const source = benchmarkSource(width, height)
  const renderer = new WebGpuCompositionRenderer(canvas)
  const renderErrors: string[] = []
  const initializeStart = performance.now()

  try {
    await renderer.initialize({
      resolveImage: async () => source,
      onDeviceLost: (message) => renderErrors.push(`device-lost: ${message}`),
      onError: (message) => renderErrors.push(message),
    })
    const initializeMs = performance.now() - initializeStart
    const composition = benchmarkComposition(width, height)
    const frameTimes: number[] = []
    let firstFrameMs = 0
    for (let index = 0; index < frameCount; index += 1) {
      const frameStart = performance.now()
      try {
        await renderer.render(composition, index / 30)
        await renderer.waitForGpu()
      } catch (error: unknown) {
        renderErrors.push(error instanceof Error ? error.message : String(error))
        break
      }
      const frameMs = performance.now() - frameStart
      if (index === 0) firstFrameMs = frameMs
      frameTimes.push(frameMs)
    }
    if (!renderer.capabilities) throw new Error('WebGPU 设备能力读取失败')
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      environment,
      runtime: renderer.capabilities,
      initializeMs,
      benchmark: {
        canvasWidth: width,
        canvasHeight: height,
        frameCount: frameTimes.length,
        firstFrameMs,
        averageFrameMs: frameTimes.length > 0
          ? frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length
          : 0,
        p95FrameMs: percentile(frameTimes, 0.95),
        minFrameMs: frameTimes.length > 0 ? Math.min(...frameTimes) : 0,
        maxFrameMs: frameTimes.length > 0 ? Math.max(...frameTimes) : 0,
        renderErrors,
      },
      memory: memorySnapshot(),
    }
  } finally {
    renderer.destroy()
  }
}
