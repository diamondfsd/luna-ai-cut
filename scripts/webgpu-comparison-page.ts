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
}

interface ComparisonApi {
  initialize(config: ComparisonConfig): Promise<{ navigatorGpu: boolean }>
  renderFeature(id: string): Promise<{ elapsedMs: number; layerCount: number }>
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
let pendingRender: { resolve: () => void; reject: (error: Error) => void } | null = null

function rejectPending(error: unknown): void {
  const current = pendingRender
  pendingRender = null
  current?.reject(error instanceof Error ? error : new Error(String(error)))
}

function waitForRender(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      pendingRender = null
      reject(new Error('WebGPU standalone render timed out'))
    }, 15_000)
    pendingRender = {
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
      waitForGpu: true,
      rasterizeImages: true,
      onVideoElement: () => undefined,
      onFallback: (reason) => rejectPending(new Error(reason)),
      onRender: () => pendingRender?.resolve(),
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

  destroy(): void {
    rejectPending(new Error('WebGPU standalone renderer destroyed'))
    renderer?.destroy()
    renderer = null
    config = null
  },
}
