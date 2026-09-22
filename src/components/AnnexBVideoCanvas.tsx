import { useEffect, useRef } from 'react'

import { buildCodecString, detectCodec, drainAccessUnits, splitNalUnits } from '../lib/annexB'

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
  configure(config: { codec: string; optimizeForLatency?: boolean }): void
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
  className?: string
  onFrame: (dimensions: { width: number; height: number }) => void
  onError: (message: string) => void
}

export function AnnexBVideoCanvas({ url, className, onFrame, onError }: AnnexBVideoCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvasAtMount = canvasRef.current
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

    if (!codecs) {
      onError('当前系统不支持相机视频预览')
      return () => undefined
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
      const canvas = canvasAtMount
      if (!canvas || disposed) {
        frame.close()
        return
      }
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth
      if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight
      canvas.getContext('2d')?.drawImage(frame as unknown as CanvasImageSource, 0, 0)
      const dimensions = { width: frame.displayWidth, height: frame.displayHeight }
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
            decoder.configure({ codec: codecString, optimizeForLatency: true })
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
      canvasAtMount?.getContext('2d')?.clearRect(0, 0, canvasAtMount.width, canvasAtMount.height)
    }
  }, [onError, onFrame, url])

  return <canvas ref={canvasRef} className={className} aria-label="直播画面" />
}
