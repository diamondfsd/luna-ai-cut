import { useEffect, useRef, useState } from 'react'
import type { CompositionInput } from '../shared/types'

const PREVIEW_FPS = 30
const PREVIEW_MAX_SIDE = 1280 // 从 1600 降低到 1280

interface RenderFrameOutput {
  width: number
  height: number
  data: Uint8Array | ArrayBuffer | { data?: number[] }
}

interface LunaRenderCompositionApi {
  init(): Promise<void>
  renderCompositionFrame(composition: CompositionInput, time: number, maxSide?: number): Promise<RenderFrameOutput>
}

function lrc(): LunaRenderCompositionApi | undefined {
  return (window as unknown as { lunaRenderCore?: LunaRenderCompositionApi }).lunaRenderCore
}

function bytesFromRenderData(data: RenderFrameOutput['data']): Uint8ClampedArray {
  if (data instanceof Uint8Array) return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8ClampedArray(data)
  if (Array.isArray(data.data)) return new Uint8ClampedArray(data.data)
  return new Uint8ClampedArray(data as ArrayBuffer)
}

interface CompositionPreviewCanvasProps {
  composition: CompositionInput | null
  className?: string
  playing?: boolean
  startTime?: number
  onTimeChange?: (time: number) => void
  onPlaybackEnd?: () => void
  onError?: (message: string) => void
}

export function CompositionPreviewCanvas({
  composition,
  className,
  playing = true,
  startTime = 0,
  onTimeChange,
  onPlaybackEnd,
  onError,
}: CompositionPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositionRef = useRef<CompositionInput | null>(composition)
  const readyRef = useRef(false)
  const renderingRef = useRef(false)
  const pendingRenderTimeRef = useRef<number | null>(null)
  const timeRef = useRef(0)
  const startTimeRef = useRef(startTime)
  const rafRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const endedRef = useRef(false)
  const wasPlayingRef = useRef(playing)
  const [fatalError, setFatalError] = useState<string | null>(null)
  compositionRef.current = composition

  async function renderAt(time: number): Promise<void> {
    const api = lrc()
    const canvas = canvasRef.current
    const current = compositionRef.current
    if (renderingRef.current) {
      pendingRenderTimeRef.current = time
      return
    }
    if (!api || !canvas || !current || !readyRef.current) return
    renderingRef.current = true
    try {
      const result = await api.renderCompositionFrame(current, time, PREVIEW_MAX_SIDE)
      if (pendingRenderTimeRef.current !== null) return
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画布不可用')
      canvas.width = result.width
      canvas.height = result.height
      context.putImageData(new ImageData(bytesFromRenderData(result.data), result.width, result.height), 0, 0)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      renderingRef.current = false
      const pendingTime = pendingRenderTimeRef.current
      pendingRenderTimeRef.current = null
      if (pendingTime !== null) void renderAt(pendingTime)
    }
  }

  useEffect(() => {
    const api = lrc()
    if (!api) {
      const message = '渲染引擎未加载'
      setFatalError(message)
      onError?.(message)
      return
    }
    api.init()
      .then(() => {
        readyRef.current = true
        void renderAt(timeRef.current)
      })
      .catch((error: Error) => {
        const message = `渲染引擎初始化失败: ${error.message}`
        setFatalError(message)
        onError?.(message)
      })
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    void renderAt(timeRef.current)
  }, [composition])

  useEffect(() => {
    if (startTimeRef.current === startTime) return
    startTimeRef.current = startTime
    timeRef.current = startTime
    endedRef.current = false
    onTimeChange?.(startTime)
    void renderAt(startTime)
  }, [startTime, onTimeChange])

  useEffect(() => {
    const current = compositionRef.current
    const duration = current?.canvas.duration ?? 5
    if (playing && !wasPlayingRef.current && endedRef.current) {
      timeRef.current = 0
      endedRef.current = false
      lastFrameAtRef.current = 0
      onTimeChange?.(0)
      void renderAt(0)
    }
    if (playing && duration > 0 && timeRef.current >= duration) {
      timeRef.current = 0
      endedRef.current = false
      lastFrameAtRef.current = 0
      onTimeChange?.(0)
      void renderAt(0)
    }
    wasPlayingRef.current = playing
  }, [playing, onTimeChange])

  useEffect(() => {
    function tick(now: number) {
      const current = compositionRef.current
      if (
        playing
        && current
        && readyRef.current
        && !renderingRef.current
        && now - lastFrameAtRef.current >= 1000 / PREVIEW_FPS
      ) {
        lastFrameAtRef.current = now
        const duration = current.canvas.duration ?? 5
        const nextTime = duration > 0 ? timeRef.current + 1 / PREVIEW_FPS : 0
        if (duration > 0 && nextTime >= duration) {
          timeRef.current = duration
          endedRef.current = true
          onTimeChange?.(duration)
          onPlaybackEnd?.()
          void renderAt(Math.max(0, duration - 1 / PREVIEW_FPS))
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        timeRef.current = nextTime
        onTimeChange?.(timeRef.current)
        void renderAt(timeRef.current)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  if (fatalError) return <div className={className}>{fatalError}</div>
  return <canvas ref={canvasRef} className={className} />
}
