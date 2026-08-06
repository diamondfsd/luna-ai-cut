import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import type { TimelineItem } from '@freecut/types/timeline'
import { useZoomStore } from '../stores/zoom-store'
import { useTimelineSettingsStore } from '../stores/timeline-settings-store'
import { drawInactiveTimelineCanvasItems } from './timeline-item-canvas-rendering'

interface TimelineItemCanvasLayerProps {
  items: ReadonlyArray<TimelineItem>
  promotedItemIds: ReadonlySet<string>
  trackHeight: number
  trackHidden: boolean
}

function getCanvasDrawSurface({
  canvas,
  scrollContainer,
  viewportWidth,
  trackHeight,
}: {
  canvas: HTMLCanvasElement | null
  scrollContainer: HTMLElement | null
  viewportWidth: number
  trackHeight: number
}) {
  if (!canvas || !scrollContainer) return null
  if (viewportWidth <= 0 || trackHeight <= 0) return null

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const backingWidth = Math.max(1, Math.ceil(viewportWidth * dpr))
  const backingHeight = Math.max(1, Math.ceil(trackHeight * dpr))
  if (canvas.width !== backingWidth) canvas.width = backingWidth
  if (canvas.height !== backingHeight) canvas.height = backingHeight
  canvas.style.width = `${viewportWidth}px`
  canvas.style.height = `${trackHeight}px`

  const context = canvas.getContext('2d')
  return context ? { canvas, context, dpr, scrollContainer } : null
}

export const TimelineItemCanvasLayer = memo(function TimelineItemCanvasLayer({
  items,
  promotedItemIds,
  trackHeight,
  trackHidden,
}: TimelineItemCanvasLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const itemsRef = useRef(items)
  const promotedItemIdsRef = useRef(promotedItemIds)
  const trackHeightRef = useRef(trackHeight)
  const trackHiddenRef = useRef(trackHidden)
  const viewportWidthRef = useRef(0)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const drawRafRef = useRef<number | null>(null)

  itemsRef.current = items
  promotedItemIdsRef.current = promotedItemIds
  trackHeightRef.current = trackHeight
  trackHiddenRef.current = trackHidden

  const draw = useCallback(() => {
    drawRafRef.current = null
    const viewportWidth = viewportWidthRef.current
    const liveTrackHeight = trackHeightRef.current
    const surface = getCanvasDrawSurface({
      canvas: canvasRef.current,
      scrollContainer: scrollContainerRef.current,
      viewportWidth,
      trackHeight: liveTrackHeight,
    })
    if (!surface) return
    const { canvas, context, dpr, scrollContainer } = surface
    const drawStartedAt = performance.now()
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, viewportWidth, liveTrackHeight)
    context.globalAlpha = trackHiddenRef.current ? 0.35 : 1
    context.font = '500 11px system-ui, sans-serif'
    context.textBaseline = 'middle'

    const { pixelsPerSecond } = useZoomStore.getState()
    const { fps } = useTimelineSettingsStore.getState()
    const scrollLeft = scrollContainer.scrollLeft
    const renderedItemCount = drawInactiveTimelineCanvasItems({
      context,
      items: itemsRef.current,
      promotedItemIds: promotedItemIdsRef.current,
      fps,
      pixelsPerSecond,
      scrollLeft,
      trackHeight: liveTrackHeight,
      viewportWidth,
    })

    context.globalAlpha = 1
    canvas.dataset.renderedItemCount = String(renderedItemCount)
    canvas.dataset.lastDrawDurationMs = (performance.now() - drawStartedAt).toFixed(3)
  }, [])

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current !== null) return
    drawRafRef.current = requestAnimationFrame(draw)
  }, [draw])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scrollContainer = canvas.closest('.timeline-container') as HTMLElement | null
    if (!scrollContainer) return

    scrollContainerRef.current = scrollContainer
    const updateViewportWidth = () => {
      viewportWidthRef.current = scrollContainer.clientWidth
      scheduleDraw()
    }
    updateViewportWidth()

    const resizeObserver = new ResizeObserver(updateViewportWidth)
    resizeObserver.observe(scrollContainer)
    scrollContainer.addEventListener('scroll', scheduleDraw, { passive: true })
    const unsubscribeZoom = useZoomStore.subscribe(scheduleDraw)
    const unsubscribeSettings = useTimelineSettingsStore.subscribe((state, previousState) => {
      if (state.fps !== previousState.fps) scheduleDraw()
    })

    return () => {
      resizeObserver.disconnect()
      scrollContainer.removeEventListener('scroll', scheduleDraw)
      unsubscribeZoom()
      unsubscribeSettings()
      scrollContainerRef.current = null
      if (drawRafRef.current !== null) {
        cancelAnimationFrame(drawRafRef.current)
        drawRafRef.current = null
      }
    }
  }, [scheduleDraw])

  useLayoutEffect(() => {
    scheduleDraw()
  }, [items, promotedItemIds, trackHeight, trackHidden, scheduleDraw])

  return (
    <canvas
      ref={canvasRef}
      data-timeline-canvas-layer="true"
      aria-hidden="true"
      className="pointer-events-none"
      style={{
        position: 'sticky',
        left: 0,
        top: 0,
        display: 'block',
        zIndex: 0,
        contain: 'strict',
      }}
    />
  )
})
