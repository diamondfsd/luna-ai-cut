import { useEffect, useRef, useState } from 'react'

import type { PreviewLayer } from '../shared/types'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { WebGpuCompositionRenderer } from '../lib/webgpu/composition'
import { readWebGpuLut } from '../lib/webgpu/lut-source'
import { loadWebGpuMask } from '../lib/webgpu/mask-source'
import { buildCompositionFromPreviewLayers } from './renderComposition'
import { useCanvasViewportInteraction } from './useCanvasViewportInteraction'
import './LrcRender.css'

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
  const url = filePathToPreviewUrl(path) ?? path
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
    void renderer.render(composition, time).then(async () => {
      await renderer.waitForGpu()
      if (destroyedRef.current || revision !== renderRevisionRef.current) return
      callbacksRef.current.onRender?.()
    }).catch((error: unknown) => {
      if (destroyedRef.current || revision !== renderRevisionRef.current) return
      const message = error instanceof Error ? error.message : String(error)
      setFatalError(message)
      callbacksRef.current.onError?.(message)
    })
  }, [canvasHeight, canvasWidth, fatalError, layers, maxSide, ready, time])

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
