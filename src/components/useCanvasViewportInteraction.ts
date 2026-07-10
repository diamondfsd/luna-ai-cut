import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { PreviewLayer } from '../shared/types'

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
  interactiveImageLayerIndexes?: readonly number[]
  minImageScale: number
  maxImageScale: number
}

const INITIAL_VIEWPORT: ViewportTransform = {
  scale: 1,
  translateX: 0,
  translateY: 0,
}

export function useCanvasViewportInteraction({
  layers,
  interactiveImageLayerIndexes,
  minImageScale,
  maxImageScale,
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
    return !!layer && !layer.isVideo && !layer.positioning
  })
  const sourceKey = interactiveIndexes
    .map((index) => layers[index]?.filePath ?? '')
    .join('\n')

  useEffect(() => {
    setViewport(INITIAL_VIEWPORT)
    dragRef.current = null
    setDragging(false)
  }, [interactive, sourceKey])

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
    setViewport((current) => ({
      ...current,
      translateX: drag.translateX + event.clientX - drag.clientX,
      translateY: drag.translateY + event.clientY - drag.clientY,
    }))
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
    const rect = event.currentTarget.getBoundingClientRect()
    const lowerBound = Math.max(0.01, Math.min(minImageScale, maxImageScale))
    const upperBound = Math.max(lowerBound, maxImageScale)

    setViewport((current) => {
      const nextScale = Math.min(
        upperBound,
        Math.max(lowerBound, current.scale * Math.exp(-event.deltaY * 0.0015)),
      )
      const scaleRatio = nextScale / current.scale
      return {
        scale: nextScale,
        translateX: current.translateX + (event.clientX - (rect.left + rect.width / 2)) * (1 - scaleRatio),
        translateY: current.translateY + (event.clientY - (rect.top + rect.height / 2)) * (1 - scaleRatio),
      }
    })
  }, [maxImageScale, minImageScale])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    setViewport(INITIAL_VIEWPORT)
  }, [])

  const style = useMemo<CSSProperties>(() => ({
    transform: `translate3d(${viewport.translateX}px, ${viewport.translateY}px, 0) scale(${viewport.scale})`,
  }), [viewport])

  return {
    interactive,
    dragging,
    style,
    onPointerDown: interactive ? onPointerDown : undefined,
    onPointerMove: interactive ? onPointerMove : undefined,
    onPointerEnd: interactive ? onPointerEnd : undefined,
    onWheel: interactive ? onWheel : undefined,
    onDoubleClick: interactive ? onDoubleClick : undefined,
  }
}
