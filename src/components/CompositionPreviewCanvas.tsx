import { useEffect, useRef, useState } from 'react'
import type { CompositionInput } from '../shared/types'

const PREVIEW_FPS = 30
const PREVIEW_MAX_SIDE = 1600

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
  onError?: (message: string) => void
}

export function CompositionPreviewCanvas({ composition, className, playing = true, startTime = 0, onTimeChange, onError }: CompositionPreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositionRef = useRef<CompositionInput | null>(composition)
  const readyRef = useRef(false)
  const renderingRef = useRef(false)
  const timeRef = useRef(0)
  const rafRef = useRef(0)
  const lastFrameAtRef = useRef(0)
  const [fatalError, setFatalError] = useState<string | null>(null)
  compositionRef.current = composition

  async function renderAt(time: number): Promise<void> {
    const api = lrc()
    const canvas = canvasRef.current
    const current = compositionRef.current
    if (!api || !canvas || !current || !readyRef.current || renderingRef.current) return
    renderingRef.current = true
    try {
      const result = await api.renderCompositionFrame(current, time, PREVIEW_MAX_SIDE)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('画布不可用')
      canvas.width = result.width
      canvas.height = result.height
      context.putImageData(new ImageData(bytesFromRenderData(result.data), result.width, result.height), 0, 0)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      renderingRef.current = false
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
        void renderAt(0)
      })
      .catch((error: Error) => {
        const message = `渲染引擎初始化失败: ${error.message}`
        setFatalError(message)
        onError?.(message)
      })
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    timeRef.current = startTime
    onTimeChange?.(startTime)
    void renderAt(startTime)
  }, [composition, startTime])

  useEffect(() => {
    function tick(now: number) {
      const current = compositionRef.current
      if (playing && current && readyRef.current && now - lastFrameAtRef.current >= 1000 / PREVIEW_FPS) {
        lastFrameAtRef.current = now
        const duration = current.canvas.duration ?? 5
        timeRef.current = duration > 0 ? (timeRef.current + 1 / PREVIEW_FPS) % duration : 0
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
