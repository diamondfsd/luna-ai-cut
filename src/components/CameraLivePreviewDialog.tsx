import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraOff, Copy, Radio, Square } from 'lucide-react'

import { Button, Dialog, IconButton, LoadingIndicator, toast } from '../ui'
import { buildCodecString, detectCodec, drainAccessUnits, splitNalUnits } from '../lib/annexB'
import type { CameraVideoStreamStatus } from '../shared/types'
import '../styles/camera-live-preview.css'

interface CameraLivePreviewDialogProps {
  open: boolean
  connected: boolean
  deviceId?: string
  host?: string
  mode: 'wireless' | 'wired'
  onOpenChange: (open: boolean) => void
}

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

function LiveCanvas({ url, onFrame, onError }: {
  url: string
  onFrame: (dimensions: { width: number; height: number }) => void
  onError: (message: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
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
      const canvas = canvasRef.current
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

      while (!disposed) {
        const { value, done } = await reader.read()
        if (done) break
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
              if (!disposed) onError(`相机视频解码失败：${decoderError.message}`)
            },
          })
          try {
            decoder.configure({ codec: codecString, optimizeForLatency: true })
          } catch (error) {
            onError(`相机视频格式无法播放：${error instanceof Error ? error.message : String(error)}`)
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
            if (!disposed) onError(`相机视频解码失败：${decodeError instanceof Error ? decodeError.message : String(decodeError)}`)
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
    }
  }, [onError, onFrame, url])

  return <canvas ref={canvasRef} className="camera-live-preview-canvas" aria-label="相机实时画面" />
}

export function CameraLivePreviewDialog({ open, connected, deviceId, host, mode, onOpenChange }: CameraLivePreviewDialogProps) {
  const [status, setStatus] = useState<CameraVideoStreamStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [obsError, setObsError] = useState<string | null>(null)
  const [obsBusy, setObsBusy] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const [streamDimensions, setStreamDimensions] = useState<{ width: number; height: number } | null>(null)
  const handleFrame = useCallback((dimensions: { width: number; height: number }) => {
    setHasFrame(true)
    setStreamDimensions((current) => (
      current?.width === dimensions.width && current.height === dimensions.height ? current : dimensions
    ))
  }, [])
  const handleError = useCallback((message: string) => setError(message), [])

  useEffect(() => {
    if (!open || !connected) {
      setHasFrame(false)
      setStreamDimensions(null)
      if (!open) setStatus(null)
      return
    }

    let cancelled = false
    setHasFrame(false)
    setStreamDimensions(null)
    setError(null)
    setObsError(null)
    setObsBusy(false)
    setStatus(null)
    void window.luna.cameraVideoStream.start({ mode, deviceId, host })
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
      void window.luna.cameraVideoStream.stop({ mode, deviceId, host })
    }
  }, [connected, deviceId, host, mode, open])

  async function toggleObsStream(): Promise<void> {
    if (!status || obsBusy) return
    setObsBusy(true)
    setObsError(null)
    try {
      const nextStatus = status.obsStreamUrl
        ? await window.luna.cameraVideoStream.stopObs({ mode, deviceId, host })
        : await window.luna.cameraVideoStream.startObs({ mode, deviceId, host })
      setStatus(nextStatus)
      if (nextStatus.obsStreamUrl) toast.success('OBS 地址已启动')
    } catch (cause: unknown) {
      setObsError(cause instanceof Error ? cause.message : 'OBS 地址启动失败')
    } finally {
      setObsBusy(false)
    }
  }

  async function copyObsUrl(): Promise<void> {
    const url = status?.obsStreamUrl
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      toast.success('OBS 地址已复制')
    } catch {
      setObsError('无法复制地址，请手动选择并复制')
    }
  }

  const waiting = !error && (!status || status.state === 'starting' || (status.state === 'running' && !hasFrame))
  const unsupported = status?.state === 'unsupported'
  const isObsStreaming = Boolean(status?.obsStreamUrl)
  const canControlObs = status?.state === 'running'

  const footer = (
    <div className={`camera-live-preview-footer${isObsStreaming ? ' is-streaming' : ''}`}>
      {isObsStreaming ? (
        <div className="camera-live-preview-obs-url" aria-live="polite">
          <span>OBS 推流地址</span>
          <div className="camera-live-preview-obs-url-value">
            <code>{status?.obsStreamUrl}</code>
            <IconButton
              variant="ghost"
              size="mini"
              icon={<Copy size={14} />}
              aria-label="复制 OBS 推流地址"
              title="复制 OBS 推流地址"
              onClick={() => void copyObsUrl()}
              disabled={obsBusy}
            />
          </div>
        </div>
      ) : null}
      <Button
        variant="secondary"
        size="compact"
        onClick={() => onOpenChange(false)}
      >
        关闭
      </Button>
      {canControlObs ? (
        <Button
          variant={isObsStreaming ? 'danger' : 'secondary'}
          size="compact"
          icon={isObsStreaming ? <Square size={13} /> : <Radio size={15} />}
          onClick={() => void toggleObsStream()}
          disabled={obsBusy}
        >
          {obsBusy ? '准备中...' : isObsStreaming ? '停止推流' : '启动推流'}
        </Button>
      ) : null}
      {obsError && <span className="camera-live-preview-obs-error" role="alert">{obsError}</span>}
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="相机预览"
      className="camera-live-preview-dialog"
      tone="dark"
      footer={footer}
    >
      <div className="camera-live-preview-body">
        <div
          className="camera-live-preview-stage"
          style={streamDimensions ? { aspectRatio: `${streamDimensions.width} / ${streamDimensions.height}` } : undefined}
        >
          {status?.streamUrl && status.state === 'running' && !unsupported ? (
            <LiveCanvas url={status.streamUrl} onFrame={handleFrame} onError={handleError} />
          ) : null}
          {waiting && (
            <div className="camera-live-preview-placeholder">
              <LoadingIndicator label="正在连接相机画面" size="large" variant="media" />
            </div>
          )}
          {unsupported && (
            <div className="camera-live-preview-placeholder">
              <CameraOff size={28} />
              <span>{status.message}</span>
            </div>
          )}
          {error && (
            <div className="camera-live-preview-placeholder camera-live-preview-error" role="alert">
              <CameraOff size={28} />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="camera-live-preview-status" aria-live="polite">
          <span className={`camera-live-preview-dot ${hasFrame ? 'active' : ''}`} />
          <span>{hasFrame ? '正在接收画面' : status?.message ?? '准备相机预览'}</span>
          {streamDimensions ? (
            <span className="camera-live-preview-resolution">
              分辨率 {streamDimensions.width} × {streamDimensions.height}
            </span>
          ) : null}
          {status && status.frames > 0 ? <span className="camera-live-preview-count">已接收画面</span> : null}
        </div>
      </div>
    </Dialog>
  )
}
