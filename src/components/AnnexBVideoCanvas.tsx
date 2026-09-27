import { useEffect, useRef, useState } from 'react'

import { buildCodecString, detectCodec, drainAccessUnits, splitNalUnits } from '../lib/annexB'
import { LiveVideoWebGpuRenderer, type LiveVideoColorAdjustments } from './LiveVideoWebGpuRenderer'
import { livePreviewOutputSize } from './livePreviewSizing'

interface DecodedVideoFrame {
  displayWidth: number
  displayHeight: number
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
}: AnnexBVideoCanvasProps) {
  const webGpuCanvasRef = useRef<HTMLCanvasElement>(null)
  const fallbackCanvasRef = useRef<HTMLCanvasElement>(null)
  const webGpuRendererRef = useRef<LiveVideoWebGpuRenderer | null>(null)
  const lutPathRef = useRef(lutPath)
  const lutIntensityRef = useRef(lutIntensity)
  const colorAdjustmentsRef = useRef(colorAdjustments)
  const onEffectErrorRef = useRef(onEffectError)
  const [webGpuReady, setWebGpuReady] = useState(false)
  lutPathRef.current = lutPath
  lutIntensityRef.current = lutIntensity
  colorAdjustmentsRef.current = colorAdjustments
  onEffectErrorRef.current = onEffectError

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

    setWebGpuReady(false)
    onWebGpuReadyChange?.(false)

    if (!codecs) {
      onError('当前系统不支持相机视频预览')
      return () => undefined
    }

    if (webGpuCanvas) {
      void LiveVideoWebGpuRenderer.create(webGpuCanvas, () => {
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
        webGpuRenderer = renderer
        webGpuRendererRef.current = renderer
        if (renderer) {
          if (colorAdjustmentsRef.current) renderer.setColorAdjustments(colorAdjustmentsRef.current)
          void renderer.setLut(lutPathRef.current, lutIntensityRef.current).catch((error: unknown) => {
            onEffectErrorRef.current?.(error instanceof Error ? error.message : String(error))
          })
        }
      }).catch((error: unknown) => {
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
        console.error('[LivePreview] WebGPU 渲染失败，已切换兼容预览', error)
        webGpuRenderer?.dispose()
        webGpuRenderer = null
        webGpuRendererRef.current = null
        webGpuActive = false
        setWebGpuReady(false)
        onWebGpuReadyChange?.(false)
      }
      if (!gpuRendered && !webGpuActive) drawFallback(frame, outputSize.width, outputSize.height)
      const dimensions = outputSize
      frame.close()
      onFrame(dimensions)
    }

    const consume = async () => {
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error(`相机预览连接失败（${response.status}）`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('相机没有返回视频画面')

      for (;;) {
        const { value, done } = await reader.read()
        if (done || disposed) break
        if (!value) continue
        const merged = new Uint8Array(carry.length + value.length)
        merged.set(carry)
        merged.set(value, carry.length)
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
        }

        const drained = drainAccessUnits(pendingUnits, codec)
        pendingUnits = drained.pending
        for (const unit of drained.access) {
          if (decoder?.state !== 'configured') break
          if (!unit.key && !seenKeyframe) continue
          if (unit.key) seenKeyframe = true
          try {
            decoder.decode(new codecs.Chunk({
              type: unit.key ? 'key' : 'delta',
              timestamp,
              data: unit.data,
            }))
          } catch (decodeError) {
            resetDecoder()
            if (!disposed) onError(`视频解码失败：${decodeError instanceof Error ? decodeError.message : String(decodeError)}`)
          }
          timestamp += 33333
        }
      }
    }

    void consume().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (!disposed) onError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      disposed = true
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
