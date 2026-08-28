import { useEffect, useRef } from 'react'

import { logger } from '../lib/rendererLogger'
import type { PreviewLayer } from '../shared/types'
import { WebGpuVideoRenderer } from './webgpuVideoRenderer'
import './WebGpuVideoPreview.css'

interface WebGpuVideoPreviewProps {
  layers: PreviewLayer[]
  canvasWidth: number
  canvasHeight: number
  maxSide: number
  active?: boolean
  playing: boolean
  time?: number
  imageScale?: number | null
  onVideoElement?: (element: HTMLMediaElement | null) => void
  onError: (reason: string) => void
  onRender?: () => void
}

export function WebGpuVideoPreview({
  layers,
  canvasWidth,
  canvasHeight,
  maxSide,
  active = true,
  playing,
  time = 0,
  imageScale,
  onVideoElement,
  onError,
  onRender,
}: WebGpuVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGpuVideoRenderer | null>(null)
  const callbackRef = useRef({ onVideoElement, onError, onRender })
  callbackRef.current = { onVideoElement, onError, onRender }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const renderer = new WebGpuVideoRenderer(canvas, {
      canvasWidth,
      canvasHeight,
      maxSide,
      onVideoElement: (element) => callbackRef.current.onVideoElement?.(element),
      onError: (reason) => {
        logger.error('[WebGPU诊断] 预览组件收到渲染错误', { reason })
        callbackRef.current.onError(reason)
      },
      onRender: () => callbackRef.current.onRender?.(),
    })
    rendererRef.current = renderer
    const resize = () => renderer.resize()
    const frame = frameRef.current
    let resizeObserver: ResizeObserver | null = null
    if (frame && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(frame)
    }
    window.addEventListener('resize', resize)

    void renderer.initialize()
      .then(() => renderer.setLayers(layers))
      .then(() => renderer.setPlayback(active, playing, time))
      .catch((error: unknown) => {
        if (cancelled) return
        callbackRef.current.onError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      window.removeEventListener('resize', resize)
      rendererRef.current = null
      renderer.destroy()
      callbackRef.current.onVideoElement?.(null)
    }
    // The renderer owns its browser GPU resources for the lifetime of this canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    rendererRef.current?.setRenderSize(canvasWidth, canvasHeight)
  }, [canvasHeight, canvasWidth])

  useEffect(() => {
    void rendererRef.current?.setLayers(layers).catch((error: unknown) => {
      callbackRef.current.onError(error instanceof Error ? error.message : String(error))
    })
  }, [layers])

  useEffect(() => {
    void rendererRef.current?.setPlayback(active, playing, time).catch((error: unknown) => {
      callbackRef.current.onError(error instanceof Error ? error.message : String(error))
    })
  }, [active, playing, time])

  return (
    <div
      ref={frameRef}
      className="webgpu-video-preview-frame"
      style={{ aspectRatio: `${canvasWidth} / ${canvasHeight}` }}
    >
      <canvas
        ref={canvasRef}
        className="webgpu-video-preview"
        width={canvasWidth}
        height={canvasHeight}
        style={{
          transform: imageScale == null ? undefined : `scale(${imageScale})`,
        }}
        aria-label="视频预览"
      />
    </div>
  )
}
