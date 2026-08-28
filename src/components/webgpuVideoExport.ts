import { isTestBuild } from '../shared/buildChannel'
import type { PreviewLayer } from '../shared/types'
import { logger } from '../lib/rendererLogger'
import { WebGpuVideoRenderer } from './webgpuVideoRenderer'

interface EncodedVideoChunkLike {
  type: 'key' | 'delta'
  byteLength: number
  copyTo(destination: Uint8Array): void
}

interface VideoFrameLike {
  close(): void
}

interface VideoEncoderLike {
  readonly encodeQueueSize?: number
  configure(config: Record<string, unknown>): void
  encode(frame: VideoFrameLike, options?: Record<string, unknown>): void
  flush(): Promise<void>
  close(): void
}

interface VideoEncoderConstructorLike {
  new(options: { output: (chunk: EncodedVideoChunkLike) => void; error: (error: Error) => void }): VideoEncoderLike
  isConfigSupported(config: Record<string, unknown>): Promise<{ supported?: boolean; config?: Record<string, unknown> }>
}

interface VideoFrameConstructorLike {
  new(source: Uint8Array, init: {
    format: 'RGBA'
    codedWidth: number
    codedHeight: number
    timestamp: number
    duration?: number
  }): VideoFrameLike
}

interface WebGpuVideoExportApi {
  webGpuVideoBegin(
    sessionId: string,
    outputPath: string,
    sourcePath: string | null,
    width: number,
    height: number,
    fps: number,
    duration: number,
    sourceStartTime: number,
    includeAudio: boolean,
  ): Promise<void>
  webGpuVideoWrite(sessionId: string, data: Uint8Array): Promise<void>
  webGpuVideoEnd(sessionId: string): Promise<void>
  webGpuVideoCancel(sessionId: string): Promise<void>
}

function api(): WebGpuVideoExportApi {
  const value = (window as unknown as { lunaRenderCore?: WebGpuVideoExportApi }).lunaRenderCore
  if (!value?.webGpuVideoBegin) throw new Error('当前版本没有可用的视频导出加速能力')
  return value
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

function sourcePathFor(layer: PreviewLayer): string {
  if (!layer.filePath.startsWith('file://')) return layer.filePath
  try {
    return decodeURI(new URL(layer.filePath).pathname)
  } catch {
    return decodeURI(layer.filePath.slice('file://'.length))
  }
}

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function bitrateFor(qualityPreset?: string): number {
  if (!qualityPreset || qualityPreset === 'high' || qualityPreset === 'original-like') return 50_000_000
  if (qualityPreset === 'small') return 12_000_000
  if (qualityPreset === 'standard') return 24_000_000
  const custom = qualityPreset.match(/^custom:(\d+)k$/i)
  if (custom) return Math.max(100_000, Number(custom[1]) * 1_000)
  return 50_000_000
}

function codecFor(width: number, height: number): string {
  return Math.max(width, height) >= 2160 ? 'avc1.640033' : 'avc1.4D002A'
}

function videoFrameRate(fps: number | null | undefined): number {
  // WebCodecs needs an explicit rate. The native path can probe the source;
  // browser video elements do not expose the nominal stream rate.
  return Math.min(120, Math.max(1, Number.isFinite(fps) && fps && fps > 0 ? fps : 30))
}

function primaryVideoLayer(layers: PreviewLayer[]): PreviewLayer {
  const layer = layers.find((candidate) => candidate.isVideo)
  if (!layer) throw new Error('未找到视频图层')
  return layer
}

function waitForPrimaryVideo(getVideo: () => HTMLVideoElement | null): Promise<HTMLVideoElement> {
  const current = getVideo()
  if (current) return Promise.resolve(current)
  return withTimeout(new Promise((resolve, reject) => {
    const startedAt = performance.now()
    const poll = () => {
      const video = getVideo()
      if (video) {
        resolve(video)
        return
      }
      if (performance.now() - startedAt >= 15_000) {
        reject(new Error('WebGPU 导出视频源加载超时'))
        return
      }
      window.setTimeout(poll, 16)
    }
    poll()
  }), 15_500, 'WebGPU 导出视频源加载超时')
}

const MAX_ENCODER_QUEUE = 4
const MAX_PENDING_WRITES = 2
const MAX_IN_FLIGHT_CAPTURES = 2

interface PendingCapture {
  index: number
  promise: Promise<{ frame: VideoFrameLike; captureMs: number; capturedAt: number }>
  renderStartedAt: number
}

export async function exportVideoWithWebGpu(params: {
  outputPath: string
  width: number
  height: number
  layers: PreviewLayer[]
  fps?: number | null
  qualityPreset?: string
  includeAudio?: boolean
  sessionId: string
  onProgress?: (percent: number) => void | Promise<void>
}): Promise<void> {
  const videoLayer = primaryVideoLayer(params.layers)
  const width = evenDimension(params.width)
  const height = evenDimension(params.height)
  const fps = videoFrameRate(params.fps)
  const sourceStartTime = Math.max(0, (videoLayer.videoTime ?? 0) - (videoLayer.videoOffset ?? 0))
  if (typeof OffscreenCanvas === 'undefined') throw new Error('当前 Chromium 不支持离屏视频导出')
  const rendererCanvas = new OffscreenCanvas(width, height)

  let primaryVideo: HTMLVideoElement | null = null
  let rendererError: Error | null = null
  const renderer = new WebGpuVideoRenderer(rendererCanvas, {
    canvasWidth: width,
    canvasHeight: height,
    maxSide: Math.max(width, height),
    // The canvas capture below is the synchronization boundary for export.
    // Interactive preview keeps this disabled so it is not serialized by a GPU
    // fence on every animation frame.
    waitForGpu: false,
    rasterizeImages: false,
    presentToCanvas: false,
    onVideoElement: (element) => {
      primaryVideo = element instanceof HTMLVideoElement ? element : null
    },
    onError: (reason) => {
      rendererError = new Error(reason)
    },
    onRender: () => undefined,
  })

  let sessionStarted = false
  let sessionEnded = false
  const encoderGlobal = window as unknown as {
    VideoEncoder?: VideoEncoderConstructorLike
    VideoFrame?: VideoFrameConstructorLike
  }
  const Encoder = encoderGlobal.VideoEncoder
  const Frame = encoderGlobal.VideoFrame
  if (!Encoder || !Frame) throw new Error('当前 Chromium 不支持视频导出能力')

  let encoder: VideoEncoderLike | null = null
  let encodingError: Error | null = null
  let writeChain = Promise.resolve()
  let pendingWriteCount = 0
  let encodedBytes = 0
  let ipcWriteTotalMs = 0
  const pendingCaptures: PendingCapture[] = []
  const startedAt = performance.now()
  try {
    await renderer.initialize()
    await renderer.setLayers(params.layers)
    const video = await waitForPrimaryVideo(() => primaryVideo)
    // The export video is detached from the visible player. Muting it makes
    // Chromium allow deterministic frame activation without user interaction.
    video.muted = true
    video.pause()
    if (video.duration && video.duration > 0 && !Number.isFinite(video.duration)) {
      throw new Error('WebGPU 导出视频时长无效')
    }
    const duration = Number.isFinite(videoLayer.videoDuration) && (videoLayer.videoDuration ?? 0) > 0
      ? videoLayer.videoDuration!
      : Math.max(0.001, (Number.isFinite(video.duration) ? video.duration : 0) - sourceStartTime)
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法确定 WebGPU 导出视频时长')
    const frameCount = Math.max(1, Math.ceil(duration * fps))
    const encoderConfig: Record<string, unknown> = {
      codec: codecFor(width, height),
      width,
      height,
      bitrate: bitrateFor(params.qualityPreset),
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'quality',
      avc: { format: 'annexb' },
    }
    const support = await Encoder.isConfigSupported(encoderConfig)
    if (!support.supported) throw new Error(`当前 Chromium 不支持 ${encoderConfig.codec} 视频编码`)

    const webGpuApi = api()
    await webGpuApi.webGpuVideoBegin(
      params.sessionId,
      params.outputPath,
      sourcePathFor(videoLayer),
      width,
      height,
      fps,
      duration,
      sourceStartTime,
      params.includeAudio !== false,
    )
    sessionStarted = true

    encoder = new Encoder({
      output: (chunk) => {
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        encodedBytes += data.byteLength
        pendingWriteCount += 1
        writeChain = writeChain
          .then(async () => {
            if (encodingError) return
            const writeStartedAt = performance.now()
            try {
              await webGpuApi.webGpuVideoWrite(params.sessionId, data)
            } finally {
              ipcWriteTotalMs += performance.now() - writeStartedAt
            }
          })
          .catch((error: unknown) => {
            encodingError = error instanceof Error ? error : new Error(String(error))
          })
          .finally(() => {
            pendingWriteCount = Math.max(0, pendingWriteCount - 1)
          })
      },
      error: (error) => {
        encodingError = error
      },
    })
    encoder.configure(support.config ?? encoderConfig)

    const captureCanvasFrame = (index: number): Promise<{
      frame: VideoFrameLike
      captureMs: number
      capturedAt: number
    }> => {
      const captureStartedAt = performance.now()
      return renderer.captureVideoFrame((rgba, frameWidth, frameHeight) => ({
        frame: new Frame(rgba, {
          format: 'RGBA',
          codedWidth: frameWidth,
          codedHeight: frameHeight,
          timestamp: Math.round(index * 1_000_000 / fps),
          duration: Math.round(1_000_000 / fps),
        }),
        captureMs: performance.now() - captureStartedAt,
        capturedAt: performance.now(),
      }))
    }

    const encodeCanvasFrame = async (index: number, captured: {
      frame: VideoFrameLike
      captureMs: number
    }): Promise<{
      captureMs: number
      encoderEncodeMs: number
      encoderQueueWaitMs: number
      ipcWriteWaitMs: number
    }> => {
      try {
        if (encodingError) throw encodingError
        const ipcWriteWaitStartedAt = performance.now()
        while (pendingWriteCount >= MAX_PENDING_WRITES) {
          if (encodingError) throw encodingError
          if (performance.now() - ipcWriteWaitStartedAt >= 30_000) {
            throw new Error('WebGPU 视频输出写入队列排空超时')
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
        const ipcWriteWaitMs = performance.now() - ipcWriteWaitStartedAt
        const encoderEncodeStartedAt = performance.now()
        encoder?.encode(captured.frame, { keyFrame: index === 0 })
        const encoderEncodeMs = performance.now() - encoderEncodeStartedAt
        const encoderQueueWaitStartedAt = performance.now()
        while ((encoder?.encodeQueueSize ?? 0) > MAX_ENCODER_QUEUE) {
          if (encodingError) throw encodingError
          if (performance.now() - encoderQueueWaitStartedAt >= 30_000) {
            throw new Error('WebGPU 视频编码队列排空超时')
          }
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
        const encoderQueueWaitMs = performance.now() - encoderQueueWaitStartedAt
        await params.onProgress?.(Math.min(99, Math.floor(((index + 1) / frameCount) * 99)))
        return { captureMs: captured.captureMs, encoderEncodeMs, encoderQueueWaitMs, ipcWriteWaitMs }
      } finally {
        captured.frame.close()
      }
    }

    const drainCapture = async (): Promise<void> => {
      const pending = pendingCaptures.shift()
      if (!pending) return
      const captured = await pending.promise
      const frameDiagnostics = await encodeCanvasFrame(pending.index, captured)
      if (pending.index === 0 || (pending.index + 1) % 30 === 0 || pending.index === frameCount - 1) {
        logger.info('[WebGPU诊断] 视频导出帧', {
          frameIndex: pending.index,
          frameCount,
          sourceTime: Math.min(duration, pending.index / fps),
          frameTotalMs: Math.round(captured.capturedAt - pending.renderStartedAt),
          captureMs: Math.round(frameDiagnostics.captureMs),
          encoderEncodeMs: Math.round(frameDiagnostics.encoderEncodeMs),
          encoderQueueWaitMs: Math.round(frameDiagnostics.encoderQueueWaitMs),
          ipcWriteWaitMs: Math.round(frameDiagnostics.ipcWriteWaitMs),
          ipcWriteTotalMs: Math.round(ipcWriteTotalMs),
          pendingWriteCount,
          encodedBytes,
          encoderQueueSize: encoder?.encodeQueueSize ?? 0,
          inFlightCaptures: pendingCaptures.length,
        })
      }
    }
    for (let index = 0; index < frameCount; index += 1) {
      if (encodingError || rendererError) throw encodingError ?? rendererError
      const time = Math.min(duration, index / fps)
      const frameStartedAt = performance.now()
      await renderer.renderFrameAt(time, { seekVideos: index === 0 })
      if (rendererError) throw rendererError
      pendingCaptures.push({ index, promise: captureCanvasFrame(index), renderStartedAt: frameStartedAt })
      if (pendingCaptures.length >= MAX_IN_FLIGHT_CAPTURES) await drainCapture()
    }
    while (pendingCaptures.length > 0) await drainCapture()
    await withTimeout(encoder.flush(), 30_000, 'WebGPU 视频编码收尾超时')
    await writeChain
    if (encodingError) throw encodingError
    await webGpuApi.webGpuVideoEnd(params.sessionId)
    sessionEnded = true
    await params.onProgress?.(100)
    logger.info('[WebGPU诊断] 视频导出完成', {
      outputPath: params.outputPath,
      width,
      height,
      fps,
      duration,
      frames: frameCount,
      elapsedMs: Math.round(performance.now() - startedAt),
      encodedBytes,
      ipcWriteTotalMs: Math.round(ipcWriteTotalMs),
      capturePath: 'gpu-texture-readback-rgba-video-frame',
      encoderQueueLimit: MAX_ENCODER_QUEUE,
      pendingWriteLimit: MAX_PENDING_WRITES,
      buildChannel: isTestBuild ? 'test' : 'stable',
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger.error('[WebGPU诊断] 视频导出失败', {
      outputPath: params.outputPath,
      width,
      height,
      fps,
      reason,
      buildChannel: isTestBuild ? 'test' : 'stable',
    })
    throw error
  } finally {
    // A failure can happen while one or two readbacks are still pending. Close
    // frames once their GPU map completes, without blocking error cleanup on a
    // second readback timeout.
    for (const pending of pendingCaptures.splice(0)) {
      void pending.promise
        .then((captured) => captured.frame.close())
        .catch(() => undefined)
    }
    encoder?.close()
    if (sessionStarted && !sessionEnded) {
      await withTimeout(writeChain, 15_000, 'WebGPU 视频输出写入收尾超时').catch(() => undefined)
      await api().webGpuVideoCancel(params.sessionId).catch(() => undefined)
    }
    renderer.destroy()
  }
}
