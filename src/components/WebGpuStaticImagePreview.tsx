import { useCallback, useEffect, useRef, useState } from 'react'

import type { CompositionInput, PreviewLayer } from '../shared/types'
import { filePathToNativeMediaPreviewUrl } from '../lib/fileUtils'
import { WebGpuCompositionRenderer } from '../lib/webgpu/composition'
import { readWebGpuLut } from '../lib/webgpu/lut-source'
import { loadWebGpuMask } from '../lib/webgpu/mask-source'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import './webgpu-preview.css'

interface WebGpuStaticImagePreviewProps {
  layers: PreviewLayer[]
  className?: string
  canvasWidth?: number
  canvasHeight?: number
  maxSide?: number
  onError?: (error: string) => void
  onReady?: () => void
  onRender?: () => void
  interactiveImageLayerIndexes?: readonly number[]
  viewportKey?: string
  maxImageScale?: number
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
  onViewportChange?: () => void
  time?: number
}

function loadImage(path: string): Promise<HTMLImageElement> {
  const url = filePathToNativeMediaPreviewUrl(path) ?? path
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`图片加载失败: ${path}`))
    image.src = url
  })
}

export function WebGpuStaticImagePreview({
  layers,
  className,
  canvasWidth,
  canvasHeight,
  maxSide,
  onError,
  onReady,
  onRender,
  interactiveImageLayerIndexes,
  viewportKey,
  maxImageScale = 5,
  imageScale,
  onImageScaleChange,
  onViewportChange,
  time = 0,
}: WebGpuStaticImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<WebGpuCompositionRenderer | null>(null)
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>())
  const renderRevisionRef = useRef(0)
  const pendingRenderRef = useRef<{ composition: CompositionInput; time: number; revision: number } | null>(null)
  const renderingRef = useRef(false)
  const destroyedRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const callbacksRef = useRef({ onError, onReady, onRender, onViewportChange })
  callbacksRef.current = { onError, onReady, onRender, onViewportChange }
  const imageInteraction = useCanvasViewportInteraction({
    layers,
    canvasRef,
    interactiveImageLayerIndexes,
    viewportKey,
    maxImageScale,
    imageScale,
    onImageScaleChange,
  })

  const drainRenderQueue = useCallback(async () => {
    if (renderingRef.current || destroyedRef.current) return
    const renderer = rendererRef.current
    if (!renderer) return

    renderingRef.current = true
    try {
      while (!destroyedRef.current) {
        const request = pendingRenderRef.current
        if (!request) break
        pendingRenderRef.current = null

        await renderer.render(request.composition, request.time)
        await renderer.waitForGpu()
        if (destroyedRef.current || request.revision !== renderRevisionRef.current) continue
        callbacksRef.current.onRender?.()
      }
    } catch (error: unknown) {
      const request = pendingRenderRef.current
      if (destroyedRef.current || (request && request.revision !== renderRevisionRef.current)) return
      const message = error instanceof Error ? error.message : String(error)
      setFatalError(message)
      callbacksRef.current.onError?.(message)
    } finally {
      renderingRef.current = false
      if (!destroyedRef.current && pendingRenderRef.current) void drainRenderQueue()
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    destroyedRef.current = false
    const renderer = new WebGpuCompositionRenderer(canvas)
    const imageCache = imageCacheRef.current
    rendererRef.current = renderer
    void renderer.initialize({
      resolveImage: async (path) => {
        const cached = imageCache.get(path)
        if (cached) return cached
        const image = await loadImage(path)
        imageCache.set(path, image)
        return image
      },
      resolveLut: readWebGpuLut,
      resolveMask: loadWebGpuMask,
      onDeviceLost: (message) => callbacksRef.current.onError?.(message),
      onError: (message) => callbacksRef.current.onError?.(message),
    }).then(() => {
      if (destroyedRef.current) return
      setReady(true)
      callbacksRef.current.onReady?.()
    }).catch((error: unknown) => {
      if (destroyedRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setFatalError(message)
      callbacksRef.current.onError?.(message)
    })

    return () => {
      destroyedRef.current = true
      renderRevisionRef.current += 1
      pendingRenderRef.current = null
      renderer.destroy()
      rendererRef.current = null
      imageCache.clear()
    }
  }, [])

  useEffect(() => {
    if (!ready || !canvasWidth || !canvasHeight || fatalError) return
    const renderer = rendererRef.current
    if (!renderer) return
    const revision = ++renderRevisionRef.current
    const composition = buildCompositionFromPreviewLayers(layers, canvasWidth, canvasHeight)
    if (maxSide && Math.max(composition.canvas.width, composition.canvas.height) > maxSide) {
      const scale = maxSide / Math.max(composition.canvas.width, composition.canvas.height)
      composition.canvas.width = Math.max(1, Math.round(composition.canvas.width * scale))
      composition.canvas.height = Math.max(1, Math.round(composition.canvas.height * scale))
    }
    pendingRenderRef.current = { composition, time, revision }
    void drainRenderQueue()
  }, [canvasHeight, canvasWidth, drainRenderQueue, fatalError, layers, maxSide, ready, time])

  useEffect(() => {
    callbacksRef.current.onViewportChange?.()
  }, [imageInteraction.style])

  if (fatalError) {
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      data-renderer="webgpu"
      className={[
        className,
        imageInteraction.interactive && 'lrc-render-interactive',
        imageInteraction.dragging && 'is-dragging',
      ].filter(Boolean).join(' ')}
      style={imageInteraction.style}
      onPointerDown={imageInteraction.onPointerDown}
      onPointerMove={imageInteraction.onPointerMove}
      onPointerUp={imageInteraction.onPointerEnd}
      onPointerCancel={imageInteraction.onPointerEnd}
      onWheel={imageInteraction.onWheel}
      onDoubleClick={imageInteraction.onDoubleClick}
    />
  )
}
