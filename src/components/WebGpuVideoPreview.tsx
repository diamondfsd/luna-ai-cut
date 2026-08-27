import { useEffect, useRef } from 'react'

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
  onFallback: (reason: string) => void
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
  onFallback,
  onRender,
}: WebGpuVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGpuVideoRenderer | null>(null)
  const callbackRef = useRef({ onVideoElement, onFallback, onRender })
  callbackRef.current = { onVideoElement, onFallback, onRender }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const renderer = new WebGpuVideoRenderer(canvas, {
      canvasWidth,
      canvasHeight,
      maxSide,
      onVideoElement: (element) => callbackRef.current.onVideoElement?.(element),
      onFallback: (reason) => callbackRef.current.onFallback(reason),
      onRender: () => callbackRef.current.onRender?.(),
    })
    rendererRef.current = renderer

    void renderer.initialize()
      .then(() => renderer.setLayers(layers))
      .then(() => renderer.setPlayback(active, playing, time))
      .catch((error: unknown) => {
        if (cancelled) return
        callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      rendererRef.current = null
      renderer.destroy()
      callbackRef.current.onVideoElement?.(null)
    }
    // The renderer owns its browser GPU resources for the lifetime of this canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void rendererRef.current?.setLayers(layers).catch((error: unknown) => {
      callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
    })
  }, [layers])

  useEffect(() => {
    void rendererRef.current?.setPlayback(active, playing, time).catch((error: unknown) => {
      callbackRef.current.onFallback(error instanceof Error ? error.message : String(error))
    })
  }, [active, playing, time])

  return (
    <canvas
      ref={canvasRef}
      className="webgpu-video-preview"
      width={canvasWidth}
      height={canvasHeight}
      style={{
        aspectRatio: `${canvasWidth} / ${canvasHeight}`,
        transform: imageScale == null ? undefined : `scale(${imageScale})`,
      }}
      aria-label="视频预览"
    />
  )
}
