import { useEffect, useRef, useState } from 'react'

import { buildCodecString, detectCodec, drainAccessUnits, splitNalUnits } from '../lib/annexB'
import { LiveVideoWebGpuRenderer, type LiveVideoColorAdjustments } from './LiveVideoWebGpuRenderer'
import { livePreviewOutputSize } from './livePreviewSizing'

interface DecodedVideoFrame {
  displayWidth: number
  displayHeight: number
  format?: string | null
  colorSpace?: { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }
  close(): void
}

interface EncodedVideoChunkLike {
  new(options: { type: 'key' | 'delta'; timestamp: number; data: Uint8Array }): unknown
}

interface VideoDecoderLike {
  state: string
  configure(config: {
    codec: string
    optimizeForLatency?: boolean
    hardwareAcceleration?: 'prefer-hardware'
  }): void
  decode(chunk: unknown): void
  close(): void
}

interface VideoDecoderConstructor {
  new(options: { output: (frame: DecodedVideoFrame) => void; error: (error: Error) => void }): VideoDecoderLike
}

function webCodecs(): { Decoder: VideoDecoderConstructor; Chunk: EncodedVideoChunkLike } | null {
  const globals = globalThis as typeof globalThis & {
    VideoDecoder?: VideoDecoderConstructor
    EncodedVideoChunk?: EncodedVideoChunkLike
  }
  return globals.VideoDecoder && globals.EncodedVideoChunk
    ? { Decoder: globals.VideoDecoder, Chunk: globals.EncodedVideoChunk }
    : null
}

interface AnnexBVideoCanvasProps {
  url: string
  lutPath?: string | null
  lutIntensity?: number
  colorAdjustments?: LiveVideoColorAdjustments
  className?: string
  onFrame: (dimensions: { width: number; height: number }) => void
  onError: (message: string) => void
  onWebGpuReadyChange?: (ready: boolean) => void
  onEffectError?: (message: string) => void
  onDecodedFrame?: (frame: CanvasImageSource, width: number, height: number) => void
}

export function AnnexBVideoCanvas({
  url,
  lutPath = null,
  lutIntensity = 100,
  colorAdjustments,
  className,
  onFrame,
  onError,
  onWebGpuReadyChange,
  onEffectError,
  onDecodedFrame,
}: AnnexBVideoCanvasProps) {
  const webGpuCanvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null)
  const webGpuRendererRef = useRef<LiveVideoWebGpuRenderer | null>(null)
  const lutPathRef = useRef(lutPath)
  const lutIntensityRef = useRef(lutIntensity)
  const colorAdjustmentsRef = useRef(colorAdjustments)
  const onEffectErrorRef = useRef(onEffectError)
  const onDecodedFrameRef = useRef(onDecodedFrame)
  onDecodedFrameRef.current = onDecodedFrame
  const [webGpuReady, setWebGpuReady] = useState(false)
  lutPathRef.current = lutPath
  lutIntensityRef.current = lutIntensity
  colorAdjustmentsRef.current = colorAdjustments
  onEffectErrorRef.current = onEffectError

  useEffect(() => {
    window.luna.log('info', '[直播预览] 调色设置', { lutEnabled: Boolean(lutPath), lutIntensity, colorAdjustments })
  }, [lutPath, lutIntensity, colorAdjustments])

  useEffect(() => {
    void webGpuRendererRef.current?.setLut(lutPath, lutIntensity).catch((error: unknown) => {
      onEffectError?.(error instanceof Error ? error.message : String(error))
    })
  }, [lutIntensity, lutPath, onEffectError])

  useEffect(() => {
    if (colorAdjustments) webGpuRendererRef.current?.setColorAdjustments(colorAdjustments)
  }, [colorAdjustments])

  useEffect(() => {
    const webGpuCanvas = webGpuCanvasRef.current
    const fallbackCanvas = fallbackCanvasRef.current
    const codecs = webCodecs()
    const abort = new AbortController()
    let decoder: VideoDecoderLike | null = null
    let carry = new Uint8Array(0)
    let pendingUnits: Uint8Array[] = []
    let codec: 'h264' | 'h265' | null = null
    let configured = false
    let seenKeyframe = false
    let timestamp = 0
    let disposed = false
    let webGpuRenderer: LiveVideoWebGpuRenderer | null = null
    let webGpuActive = false
    const startedAt = Date.now()
    const stats = { bytes: 0, chunks: 0, submitted: 0, decoded: 0, keyframes: 0, errors: 0 }
    const diagnose = (event: string, details: Record<string, unknown> = {}) => {
      window.luna.log('info', '[直播预览] ' + event, { ...stats, elapsedMs: Date.now() - startedAt,
        codec, configured, seenKeyframe, pendingUnits: pendingUnits.length, carryBytes: carry.length,
        renderer: webGpuActive ? 'webgpu' : 'canvas2d', ...details })
    }
    diagnose('开始')
    const diagnosticTimer = setInterval(() => diagnose('播放统计'), 15_000)

    setWebGpuReady(false)
    onWebGpuReadyChange?.(false)

    if (!codecs) {
      clearInterval(diagnosticTimer)
      diagnose('解码器不可用')
      onError('当前系统不支持相机视频预览')
      return () => undefined
    }

    if (webGpuCanvas) {
      void LiveVideoWebGpuRenderer.create(webGpuCanvas, () => {
        diagnose('显示设备丢失')
        webGpuRenderer = null
        webGpuRendererRef.current = null
        webGpuActive = false
        if (!disposed) {
          setWebGpuReady(false)
          onWebGpuReadyChange?.(false)
        }
      }).then((renderer) => {
        if (disposed) {
          renderer?.dispose()
          return
        }
        diagnose('显示初始化', { available: Boolean(renderer) })
        webGpuRenderer = renderer
        webGpuRendererRef.current = renderer
        if (renderer) {
          if (colorAdjustmentsRef.current) renderer.setColorAdjustments(colorAdjustmentsRef.current)
          void renderer.setLut(lutPathRef.current, lutIntensityRef.current).catch((error: unknown) => {
            onEffectErrorRef.current?.(error instanceof Error ? error.message : String(error))
          })
        }
      }).catch((error: unknown) => {
        diagnose('显示初始化失败', { error: String(error) })
        console.error('[LivePreview] WebGPU 初始化失败，继续使用兼容预览', error)
      })
    }

    const drawFallback = (frame: DecodedVideoFrame, width: number, height: number) => {
      if (!fallbackCanvas) return
      if (fallbackCanvas.width !== width) fallbackCanvas.width = width
      if (fallbackCanvas.height !== height) fallbackCanvas.height = height
      const context = fallbackCanvas.getContext('2d')
      if (!context) return
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height)
    }

    const resetDecoder = () => {
      try { decoder?.close() } catch { /* Decoder may already be closed. */ }
      decoder = null
      pendingUnits = []
      codec = null
      configured = false
      seenKeyframe = false
    }

    const paint = (frame: DecodedVideoFrame) => {
      if (!webGpuCanvas || !fallbackCanvas || disposed) {
        frame.close()
        return
      }
      stats.decoded += 1
      if (stats.decoded === 1) diagnose('首个解码画面', { width: frame.displayWidth, height: frame.displayHeight, format: frame.format, colorSpace: frame.colorSpace ? { primaries: frame.colorSpace.primaries, transfer: frame.colorSpace.transfer, matrix: frame.colorSpace.matrix, fullRange: frame.colorSpace.fullRange } : null })
      const outputSize = livePreviewOutputSize(frame.displayWidth, frame.displayHeight)
      let gpuRendered = false
      try {
        gpuRendered = webGpuRenderer?.render(frame, outputSize.width, outputSize.height) ?? false
        if (gpuRendered && !webGpuActive) {
          webGpuActive = true
          setWebGpuReady(true)
          onWebGpuReadyChange?.(true)
        }
      } catch (error) {
        diagnose('显示回退', { error: String(error) })
        console.error('[LivePreview] WebGPU 渲染失败，已切换兼容预览', error)
        webGpuRenderer?.dispose()
        webGpuRenderer = null
        webGpuRendererRef.current = null
        webGpuActive = false
        setWebGpuReady(false)
        onWebGpuReadyChange?.(false)
      }
      try {
        if (!gpuRendered && !webGpuActive) drawFallback(frame, outputSize.width, outputSize.height)
        onDecodedFrameRef.current?.(frame as unknown as CanvasImageSource, frame.displayWidth, frame.displayHeight)
      } finally {
        // Recording or fallback drawing errors must not retain decoder surfaces.
        frame.close()
      }
      onFrame(outputSize)
    }

    const consume = async () => {
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error(`相机预览连接失败（${response.status}）`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('相机没有返回视频画面')

      for (;;) {
        const { value, done } = await reader.read()
        if (done || disposed) {
          if (!disposed) diagnose('视频流结束')
          break
        }
        if (!value) continue
        stats.bytes += value.length
        stats.chunks += 1
        const merged = new Uint8Array(carry.length + value.length)
        merged.set(carry)
        merged.set(value, carry.length)
        // A malformed stream must not grow memory indefinitely while waiting for headers.
        if (merged.length + pendingUnits.reduce((sum, unit) => sum + unit.length, 0) > 32 * 1024 * 1024) {
          diagnose('视频缓冲超限')
          throw new Error('视频数据异常，请重新连接')
        }
        const units = splitNalUnits(merged)
        if (units.length === 0) {
          carry = merged
          continue
        }
        const tail = units[units.length - 1]!
        carry = new Uint8Array(4 + tail.length)
        carry.set([0, 0, 0, 1])
        carry.set(tail, 4)
        for (const unit of units.slice(0, -1)) pendingUnits.push(unit.slice())
        if (pendingUnits.length === 0) continue

        codec ??= detectCodec(pendingUnits)
        if (!codec) continue
        if (!configured) {
          const codecString = buildCodecString(pendingUnits, codec)
          if (!codecString) continue
          decoder = new codecs.Decoder({
            output: paint,
            error: (decoderError) => {
              stats.errors += 1
              diagnose('异步解码失败', { error: decoderError.message })
              resetDecoder()
              if (!disposed) onError(`视频解码失败：${decoderError.message}`)
            },
          })
          try {
            decoder.configure({ codec: codecString, optimizeForLatency: true, hardwareAcceleration: 'prefer-hardware' })
          } catch (error) {
            onError(`视频格式无法播放：${error instanceof Error ? error.message : String(error)}`)
            return
          }
          configured = true
          diagnose('解码配置', { codecString })
        }

        const drained = drainAccessUnits(pendingUnits, codec)
        pendingUnits = drained.pending
        for (const unit of drained.access) {
          if (decoder?.state !== 'configured') break
          if (!unit.key && !seenKeyframe) continue
          if (unit.key) { seenKeyframe = true; stats.keyframes += 1 }
          try {
            stats.submitted += 1
            decoder.decode(new codecs.Chunk({
              type: unit.key ? 'key' : 'delta',
              timestamp,
              data: unit.data,
            }))
          } catch (decodeError) {
            stats.errors += 1
            diagnose('同步解码失败', { error: String(decodeError) })
            resetDecoder()
            if (!disposed) onError(`视频解码失败：${decodeError instanceof Error ? decodeError.message : String(decodeError)}`)
          }
          timestamp += 33333
        }
      }
    }

    void consume().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!disposed) diagnose('读取失败', { error: String(error) })
      if (!disposed) onError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      disposed = true
      clearInterval(diagnosticTimer)
      diagnose('结束')
      abort.abort()
      try { decoder?.close() } catch { /* Decoder may already be closed. */ }
      webGpuRenderer?.dispose()
      if (webGpuRendererRef.current === webGpuRenderer) webGpuRendererRef.current = null
      fallbackCanvas?.getContext('2d')?.clearRect(0, 0, fallbackCanvas.width, fallbackCanvas.height)
    }
  }, [onError, onFrame, onWebGpuReadyChange, url])

  const baseClassName = className ?? ''
  return (
    <>
      <canvas
        ref={webGpuCanvasRef}
        className={`${baseClassName} live-preview-webgpu${webGpuReady ? ' is-active' : ''}`}
        aria-label="直播画面"
      />
      <canvas
        ref={fallbackCanvasRef}
        className={`${baseClassName} live-preview-fallback${webGpuReady ? '' : ' is-active'}`}
        aria-hidden="true"
      />
    </>
  )
}
