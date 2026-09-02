import type {
  GpuCanvasContext,
  GpuDevice,
  GpuNavigator,
  GpuUploadCanvas,
  GpuUploadSource,
  WebGpuRenderCanvas,
} from './webgpuTypes'

export const TEXTURE_USAGE_COPY_SRC = 0x01
export const TEXTURE_USAGE_COPY_DST = 0x02
export const TEXTURE_USAGE_TEXTURE_BINDING = 0x04
export const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10
export const BUFFER_USAGE_UNIFORM = 0x40
export const PARAM_FLOAT_COUNT = 440
export const IDENTITY_MASK_RGBA = new Uint8Array([255, 255, 255, 255])
export const IDENTITY_SOURCE_RGBA = new Uint8Array([255, 255, 255])

export function getWebGpuNavigator(): GpuNavigator | null {
  return (navigator as Navigator & { gpu?: GpuNavigator }).gpu ?? null
}

export function getWebGpuContext(canvas: WebGpuRenderCanvas): GpuCanvasContext | null {
  return (canvas.getContext as (contextId: string, options?: unknown) => unknown).call(canvas, 'webgpu') as GpuCanvasContext | null
}

export function createTexture(device: GpuDevice, width: number, height: number, format: string, usages: number, depth = 1) {
  return device.createTexture({
    size: { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: depth },
    dimension: depth > 1 ? '3d' : '2d',
    format,
    usage: usages,
  })
}

export function srgbFormatFor(format: string): string {
  if (format === 'rgba8unorm') return 'rgba8unorm-srgb'
  if (format === 'bgra8unorm') return 'bgra8unorm-srgb'
  return format
}

export function writeTexture(device: GpuDevice, texture: ReturnType<GpuDevice['createTexture']>, data: Uint8Array, width: number, height: number, depth = 1): void {
  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: Math.max(4, width * 4), rowsPerImage: Math.max(1, height) },
    { width: Math.max(1, width), height: Math.max(1, height), depthOrArrayLayers: depth },
  )
}

interface PreparedUploadSource {
  source: GpuUploadSource
  dispose: () => void
}

function createUploadCanvas(width: number, height: number): GpuUploadCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function canvasSize(canvas: GpuUploadCanvas): { width: number; height: number } {
  return { width: canvas.width, height: canvas.height }
}

export async function prepareScaledUploadSource(
  source: HTMLImageElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
  reusableCanvas?: GpuUploadCanvas,
): Promise<PreparedUploadSource> {
  if (sourceWidth === width && sourceHeight === height) return { source, dispose: () => undefined }
  const canvas = reusableCanvas
    && canvasSize(reusableCanvas).width === width
    && canvasSize(reusableCanvas).height === height
    ? reusableCanvas
    : createUploadCanvas(width, height)
  const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!context) throw new Error('无法准备 WebGPU 视频缩放纹理')
  context.clearRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  return { source: canvas, dispose: () => undefined }
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
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

export function waitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  const videoWithFrameCallback = video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number }
  if (!videoWithFrameCallback.requestVideoFrameCallback) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
  }
  return withTimeout(new Promise((resolve) => {
    videoWithFrameCallback.requestVideoFrameCallback?.(() => resolve())
  }), 15_000, 'WebGPU 导出视频帧准备超时')
}

export function waitForAnimationFrames(count: number): Promise<void> {
  if (count <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      void waitForAnimationFrames(count - 1).then(resolve)
    })
  })
}

export async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return
  await withTimeout(new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', handleReady)
      video.removeEventListener('error', handleError)
    }
    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`视频无法在 WebGPU 导出中打开（错误代码 ${video.error?.code ?? '未知'}）`))
    }
    video.addEventListener('loadeddata', handleReady, { once: true })
    video.addEventListener('error', handleError, { once: true })
  }), 15_000, 'WebGPU 导出视频加载超时')
}

export async function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const boundedTime = Number.isFinite(video.duration) && video.duration > 0
    ? Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001))
    : Math.max(0, time)
  if (Math.abs(video.currentTime - boundedTime) >= 0.001) {
    await withTimeout(new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('seeked', handleSeeked)
        video.removeEventListener('error', handleError)
      }
      const handleSeeked = () => {
        cleanup()
        resolve()
      }
      const handleError = () => {
        cleanup()
        reject(new Error(`WebGPU 导出视频定位失败（错误代码 ${video.error?.code ?? '未知'}）`))
      }
      video.addEventListener('seeked', handleSeeked, { once: true })
      video.addEventListener('error', handleError, { once: true })
      video.currentTime = boundedTime
    }), 15_000, `WebGPU 导出视频定位超时: ${boundedTime.toFixed(3)}s`)
  }
  video.pause()
}

export async function playAndWaitForVideoFrame(video: HTMLVideoElement): Promise<void> {
  const playing = await video.play().then(() => true).catch(() => false)
  if (playing) await waitForVideoFrame(video)
  else await waitForAnimationFrames(2)
  video.pause()
}
