import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import type { PreviewLayer } from '../shared/types'
import { zoomOffsetAroundPoint } from './previewViewportGeometry'

interface ViewportTransform {
  scale: number
  translateX: number
  translateY: number
}

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  translateX: number
  translateY: number
}

interface UseCanvasViewportInteractionOptions {
  layers: PreviewLayer[]
  canvasRef: RefObject<HTMLCanvasElement | null>
  interactiveImageLayerIndexes?: readonly number[]
  viewportKey?: string
  maxImageScale: number
  imageScale?: number | null
  onImageScaleChange?: (scale: number | null) => void
}

const INITIAL_VIEWPORT: ViewportTransform = {
  scale: 1,
  translateX: 0,
  translateY: 0,
}

const WHEEL_ZOOM_SENSITIVITY = 0.005

interface CanvasMetrics {
  baseWidth: number
  baseHeight: number
  containerWidth: number
  containerHeight: number
  fitPixelRatio: number
}

function canvasMetrics(canvas: HTMLCanvasElement): CanvasMetrics | null {
  const container = canvas.parentElement
  if (!container || canvas.width <= 0 || canvas.height <= 0) return null
  const containerRect = container.getBoundingClientRect()
  // clientWidth/clientHeight are layout sizes and are not affected by the current CSS transform.
  const baseWidth = canvas.clientWidth
  const baseHeight = canvas.clientHeight
  if (baseWidth <= 0 || baseHeight <= 0) return null
  return {
    baseWidth,
    baseHeight,
    containerWidth: containerRect.width,
    containerHeight: containerRect.height,
    fitPixelRatio: Math.min(baseWidth / canvas.width, baseHeight / canvas.height),
  }
}

function clampTranslation(
  metrics: CanvasMetrics,
  scale: number,
  translateX: number,
  translateY: number,
): Pick<ViewportTransform, 'translateX' | 'translateY'> {
  const limitX = Math.max(0, (metrics.baseWidth * scale - metrics.containerWidth) / 2)
  const limitY = Math.max(0, (metrics.baseHeight * scale - metrics.containerHeight) / 2)
  return {
    translateX: Math.min(limitX, Math.max(-limitX, translateX)),
    translateY: Math.min(limitY, Math.max(-limitY, translateY)),
  }
}

export function useCanvasViewportInteraction({
  layers,
  canvasRef,
  interactiveImageLayerIndexes,
  viewportKey,
  maxImageScale,
  imageScale,
  onImageScaleChange,
}: UseCanvasViewportInteractionOptions) {
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const interactiveIndexes = useMemo(() => (
    interactiveImageLayerIndexes ?? layers.flatMap((layer, index) => (
      !layer.isVideo && !layer.positioning ? [index] : []
    ))
  ), [interactiveImageLayerIndexes, layers])
  const interactive = interactiveIndexes.some((index) => {
    const layer = layers[index]
    return !!layer && !layer.positioning
  })
  const sourceKey = viewportKey ?? interactiveIndexes
    .map((index) => layers[index]?.filePath ?? '')
    .join('\n')

  useEffect(() => {
    setViewport(INITIAL_VIEWPORT)
    dragRef.current = null
    setDragging(false)
  }, [interactive, sourceKey])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = canvas?.parentElement
    if (!interactive || !canvas || !container) return
    const observer = new ResizeObserver(() => {
      setViewport((current) => {
        const metrics = canvasMetrics(canvas)
        if (!metrics) return current
        return { ...current, ...clampTranslation(metrics, current.scale, current.translateX, current.translateY) }
      })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [canvasRef, interactive])

  const syncControlledScale = useCallback(() => {
    const canvas = canvasRef.current
    if (!interactive || !canvas) return
    setViewport((current) => {
      if (imageScale == null) return INITIAL_VIEWPORT
      const metrics = canvasMetrics(canvas)
      if (!metrics) return current
      const nextScale = Math.max(1, Math.min(maxImageScale / metrics.fitPixelRatio, imageScale / metrics.fitPixelRatio))
      return { scale: nextScale, ...clampTranslation(metrics, nextScale, current.translateX, current.translateY) }
    })
  }, [canvasRef, imageScale, interactive, maxImageScale])

  useEffect(() => {
    syncControlledScale()
  }, [sourceKey, syncControlledScale])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
    }
    setDragging(true)
  }, [viewport.translateX, viewport.translateY])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const canvas = event.currentTarget
    const clientX = event.clientX
    const clientY = event.clientY
    setViewport((current) => {
      const metrics = canvasMetrics(canvas)
      if (!metrics) return current
      const translation = clampTranslation(
        metrics,
        current.scale,
        drag.translateX + clientX - drag.clientX,
        drag.translateY + clientY - drag.clientY,
      )
      return { ...current, ...translation }
    })
  }, [])

  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }, [])

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const canvas = event.currentTarget
    const container = canvas.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()

    setViewport((current) => {
      const metrics = canvasMetrics(canvas)
      if (!metrics) return current
      const upperBound = Math.max(1, maxImageScale / metrics.fitPixelRatio)
      const nextScale = Math.min(
        upperBound,
        Math.max(1, current.scale * Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY)),
      )
      onImageScaleChange?.(nextScale <= 1.001 ? null : nextScale * metrics.fitPixelRatio)
      const offset = zoomOffsetAroundPoint(
        { x: current.translateX, y: current.translateY },
        current.scale,
        nextScale,
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2),
      )
      const translation = clampTranslation(
        metrics,
        nextScale,
        offset.x,
        offset.y,
      )
      return {
        scale: nextScale,
        ...translation,
      }
    })
  }, [maxImageScale, onImageScaleChange])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const clientX = event.clientX
    const clientY = event.clientY
    setViewport((current) => {
      const metrics = canvasMetrics(canvas)
      if (!metrics || current.scale > 1.001) {
        onImageScaleChange?.(null)
        return INITIAL_VIEWPORT
      }
      const actualSizeScale = Math.min(
        Math.max(1, 1 / metrics.fitPixelRatio),
        Math.max(1, maxImageScale / metrics.fitPixelRatio),
      )
      const translation = clampTranslation(
        metrics,
        actualSizeScale,
        (clientX - (rect.left + rect.width / 2)) * (1 - actualSizeScale),
        (clientY - (rect.top + rect.height / 2)) * (1 - actualSizeScale),
      )
      onImageScaleChange?.(actualSizeScale * metrics.fitPixelRatio)
      return { scale: actualSizeScale, ...translation }
    })
  }, [maxImageScale, onImageScaleChange])

  const style = useMemo<CSSProperties>(() => ({
    transform: `translate3d(${viewport.translateX}px, ${viewport.translateY}px, 0) scale(${viewport.scale})`,
  }), [viewport])

  return {
    interactive,
    dragging,
    style,
    syncControlledScale,
    onPointerDown: interactive ? onPointerDown : undefined,
    onPointerMove: interactive ? onPointerMove : undefined,
    onPointerEnd: interactive ? onPointerEnd : undefined,
    onWheel: interactive ? onWheel : undefined,
    onDoubleClick: interactive ? onDoubleClick : undefined,
  }
}
