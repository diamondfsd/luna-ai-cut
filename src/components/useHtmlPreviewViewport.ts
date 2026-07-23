import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'

import type { PreviewSize } from './htmlPreviewGeometry'

interface ViewportState {
  scale: number
  x: number
  y: number
}

interface DragState {
  pointerId: number
  clientX: number
  clientY: number
  x: number
  y: number
}

interface Metrics {
  baseWidth: number
  baseHeight: number
  containerWidth: number
  containerHeight: number
  fitPixelRatio: number
  maxScale: number
}

const INITIAL_VIEW: ViewportState = { scale: 1, x: 0, y: 0 }
const MAX_SOURCE_PIXEL_SCALE = 2
const WHEEL_SENSITIVITY = 0.004

function metricsFor(
  container: HTMLElement | null,
  content: HTMLElement | null,
  mediaSize: PreviewSize | null,
): Metrics | null {
  if (!container || !content || content.offsetWidth <= 0 || content.offsetHeight <= 0) return null
  const fitPixelRatio = mediaSize
    ? Math.min(content.offsetWidth / mediaSize.width, content.offsetHeight / mediaSize.height)
    : 1
  return {
    baseWidth: content.offsetWidth,
    baseHeight: content.offsetHeight,
    containerWidth: container.clientWidth,
    containerHeight: container.clientHeight,
    fitPixelRatio,
    maxScale: Math.max(1, MAX_SOURCE_PIXEL_SCALE / Math.max(0.0001, fitPixelRatio)),
  }
}

function clampView(metrics: Metrics, scale: number, x: number, y: number): ViewportState {
  if (scale <= 1.001) return INITIAL_VIEW
  const limitX = Math.max(0, (metrics.baseWidth * scale - metrics.containerWidth) / 2)
  const limitY = Math.max(0, (metrics.baseHeight * scale - metrics.containerHeight) / 2)
  return {
    scale,
    x: Math.min(limitX, Math.max(-limitX, x)),
    y: Math.min(limitY, Math.max(-limitY, y)),
  }
}

function isPreviewControl(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-preview-control]'))
}

function isNativeVideoControl(event: { target: EventTarget | null; clientY: number }): boolean {
  const video = event.target instanceof HTMLVideoElement
    ? event.target
    : event.target instanceof Element ? event.target.closest('video') : null
  if (!video?.controls) return false
  const rect = video.getBoundingClientRect()
  return event.clientY >= rect.bottom - Math.min(56, rect.height * 0.22)
}

export function useHtmlPreviewViewport(options: {
  containerRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  mediaSize: PreviewSize | null
  sourceKey: string | null
}) {
  const { containerRef, contentRef, mediaSize, sourceKey } = options
  const [view, setView] = useState(INITIAL_VIEW)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  const updateScale = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    const container = containerRef.current
    const metrics = metricsFor(container, contentRef.current, mediaSize)
    if (!container || !metrics) return
    const rect = container.getBoundingClientRect()
    setView((current) => {
      const scale = Math.max(1, Math.min(metrics.maxScale, nextScale))
      const ratio = scale / current.scale
      const anchorX = clientX == null ? 0 : clientX - (rect.left + rect.width / 2)
      const anchorY = clientY == null ? 0 : clientY - (rect.top + rect.height / 2)
      return clampView(metrics, scale, current.x + anchorX * (1 - ratio), current.y + anchorY * (1 - ratio))
    })
  }, [containerRef, contentRef, mediaSize])

  const reset = useCallback(() => setView(INITIAL_VIEW), [])
  const zoomIn = useCallback(() => updateScale(view.scale * 1.25), [updateScale, view.scale])
  const zoomOut = useCallback(() => updateScale(view.scale / 1.25), [updateScale, view.scale])

  useLayoutEffect(() => {
    reset()
    dragRef.current = null
    setDragging(false)
  }, [reset, sourceKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const metrics = metricsFor(container, contentRef.current, mediaSize)
      if (metrics) setView((current) => clampView(metrics, current.scale, current.x, current.y))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [containerRef, contentRef, mediaSize])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || view.scale <= 1.001 || isPreviewControl(event.target) || isNativeVideoControl(event)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }
    setDragging(true)
  }, [view])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const metrics = metricsFor(containerRef.current, contentRef.current, mediaSize)
    if (!metrics) return
    event.preventDefault()
    setView((current) => clampView(metrics, current.scale, drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY))
  }, [containerRef, contentRef, mediaSize])

  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
    setDragging(false)
  }, [])

  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (isPreviewControl(event.target) || isNativeVideoControl(event)) return
    event.preventDefault()
    updateScale(view.scale * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), event.clientX, event.clientY)
  }, [updateScale, view.scale])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (isPreviewControl(event.target) || isNativeVideoControl(event)) return
    event.preventDefault()
    if (view.scale > 1.001) {
      reset()
      return
    }
    const metrics = metricsFor(containerRef.current, contentRef.current, mediaSize)
    if (!metrics) return
    updateScale(Math.max(1, Math.min(metrics.maxScale, 1 / Math.max(0.0001, metrics.fitPixelRatio))), event.clientX, event.clientY)
  }, [containerRef, contentRef, mediaSize, reset, updateScale, view.scale])

  const style = useMemo<CSSProperties>(() => ({
    transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
  }), [view])
  const currentMetrics = metricsFor(containerRef.current, contentRef.current, mediaSize)

  return {
    dragging,
    isZoomed: view.scale > 1.001,
    canZoomIn: Boolean(currentMetrics && view.scale < currentMetrics.maxScale - 0.001),
    canZoomOut: view.scale > 1.001,
    style,
    reset,
    zoomIn,
    zoomOut,
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onWheel,
    onDoubleClick,
  }
}
