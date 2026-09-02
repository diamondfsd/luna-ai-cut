import { useEffect, useLayoutEffect, useRef } from 'react'

import { logger } from '../lib/rendererLogger'
import type { PreviewLayer } from '../shared/types'
import { WebGpuVideoRenderer } from './webgpuVideoRenderer'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import './WebGpuVideoPreview.css'

interface WebGpuVideoPreviewProps {
  layers: PreviewLayer[]
  canvasWidth: number
  canvasHeight: number
  maxSide: number
  className?: string
  active?: boolean
  playing: boolean
  time?: number
  imageScale?: number | null
  maxImageScale?: number
  viewportKey?: string
  interactiveImageLayerIndexes?: readonly number[]
  onImageScaleChange?: (scale: number | null) => void
  onViewportChange?: () => void
  onVideoElement?: (element: HTMLMediaElement | null) => void
  onError: (reason: string) => void
  onRender?: () => void
}

export function WebGpuVideoPreview({
  layers,
  canvasWidth,
  canvasHeight,
  maxSide,
  className,
  active = true,
  playing,
  time = 0,
  imageScale,
  maxImageScale = 5,
  viewportKey,
  interactiveImageLayerIndexes = layers.length > 0 ? [0] : [],
  onImageScaleChange,
  onViewportChange,
  onVideoElement,
  onError,
  onRender,
}: WebGpuVideoPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<WebGpuVideoRenderer | null>(null)
  const rendererInitializedRef = useRef(false)
  const layersSignatureRef = useRef<string | null>(null)
  const latestLayersRef = useRef(layers)
  const latestPlaybackRef = useRef({ active, playing, time })
  latestLayersRef.current = layers
  latestPlaybackRef.current = { active, playing, time }
  const layersSignature = JSON.stringify(layers)
  const imageInteraction = useCanvasViewportInteraction({
    layers,
    canvasRef,
    interactiveImageLayerIndexes,
    viewportKey,
    maxImageScale,
    imageScale,
    onImageScaleChange,
  })
  const callbackRef = useRef({ onVideoElement, onError, onRender })
  callbackRef.current = { onVideoElement, onError, onRender }

  useLayoutEffect(() => {
    onViewportChange?.()
  }, [imageInteraction.style, onViewportChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    logger.info('[PreviewDebug] WebGPU component mounted', {
      canvasWidth,
      canvasHeight,
      maxSide,
      active,
      playing,
      time,
      canvas: { width: canvas.width, height: canvas.height },
    })
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

    const applyLatestLayers = () => {
      const nextLayers = latestLayersRef.current
      const nextSignature = JSON.stringify(nextLayers)
      if (layersSignatureRef.current === nextSignature) return Promise.resolve()
      layersSignatureRef.current = nextSignature
      return renderer.setLayers(nextLayers)
    }

    void renderer.initialize()
      .then(() => {
        rendererInitializedRef.current = true
        logger.info('[PreviewDebug] WebGPU initialized')
        return applyLatestLayers()
      })
      .then(() => {
        const nextLayers = latestLayersRef.current
        logger.info('[PreviewDebug] WebGPU layers synchronized', { layerCount: nextLayers.length })
        const playback = latestPlaybackRef.current
        return renderer.setPlayback(playback.active, playback.playing, playback.time)
      })
      .then(() => logger.info('[PreviewDebug] WebGPU playback synchronized', latestPlaybackRef.current))
      .catch((error: unknown) => {
        if (cancelled) return
        callbackRef.current.onError(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
      rendererInitializedRef.current = false
      layersSignatureRef.current = null
      logger.info('[PreviewDebug] WebGPU component unmounted')
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
    rendererRef.current?.setMaxSide(maxSide)
  }, [maxSide])

  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !rendererInitializedRef.current || layersSignatureRef.current === layersSignature) return
    layersSignatureRef.current = layersSignature
    void renderer.setLayers(layers).catch((error: unknown) => {
      callbackRef.current.onError(error instanceof Error ? error.message : String(error))
    })
  }, [layers, layersSignature])

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
        className={`webgpu-video-preview${className ? ` ${className}` : ''}${imageInteraction.interactive ? ' is-interactive' : ''}${imageInteraction.dragging ? ' is-dragging' : ''}`}
        width={canvasWidth}
        height={canvasHeight}
        style={imageInteraction.style}
        onPointerDown={imageInteraction.onPointerDown}
        onPointerMove={imageInteraction.onPointerMove}
        onPointerUp={imageInteraction.onPointerEnd}
        onPointerCancel={imageInteraction.onPointerEnd}
        onWheel={imageInteraction.onWheel}
        onDoubleClick={imageInteraction.onDoubleClick}
        aria-label="视频预览"
      />
    </div>
  )
}
