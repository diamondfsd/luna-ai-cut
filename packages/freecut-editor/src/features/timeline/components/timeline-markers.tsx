// React and external libraries
import { useCallback, useRef, useState, useEffect, useMemo, memo } from 'react'

// Stores and selectors
import { useTimelineStore } from '../stores/timeline-store'
import { setInOutPointsWithoutHistory } from '../stores/actions/marker-actions'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import { useMicRecordingStore, isMicRecordingActive } from '@freecut/shared/state/mic-recording-store'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { perfMarkRender } from '@freecut/shared/logging/perf-marks'

// Components
import { TimelineInOutMarkers } from './timeline-in-out-markers'
import { TimelineProjectMarkers } from './timeline-project-markers'
import { previewScrubberSuppressRef } from './preview-scrubber-suppress'
import { beginIoPointerDrag, IoRangeStrip } from '@freecut/shared/timeline/io-range'
import {
  beginTimelineSkimmerScrub,
  endTimelineSkimmerScrub,
  mainTimelineScrubActiveRef,
} from '@freecut/shared/timeline/main-timeline-scrub'
import {
  getTimelineScrubViewportProgress,
  notifyTimelineScrubVisualFrame,
} from '@freecut/shared/timeline/live-scroll-sync'
import { useSettingsStore } from '@freecut/features/timeline/deps/settings'

// Utilities and hooks
import { useTimelineCommittedZoomContext } from '../contexts/timeline-zoom-context'
import { useZoomStore } from '../stores/zoom-store'
import { formatTimecode, formatTimecodeCompact, secondsToFrames } from '@freecut/shared/utils/time-utils'
import { createScrubThrottleState, shouldCommitScrubFrame } from '../utils/scrub-throttle'
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@freecut/config/editor-layout'
import { sanitizeInOutPoints } from '../utils/in-out-points'
import { frameToPixelsNow, pixelsToFrameNow } from '../utils/zoom-conversions'
import { getEdgeScrollDelta, getPlayheadEdgeScrollVelocity } from '../utils/playhead-edge-scroll'
import { drawTimelineRulerViewportCanvas } from './timeline-ruler-viewport-canvas'

interface TimelineMarkersProps {
  duration: number // Total timeline duration in seconds
  width?: number // Explicit width in pixels (optional)
}

interface MarkerInterval {
  type: 'frame' | 'second' | 'multi-second' | 'minute'
  intervalInSeconds: number
  minorTicks: number
}

// Tile configuration - 1000px tiles for faster individual renders and better cache granularity
const TILE_WIDTH = 1000
const MAX_VISIBLE_MINOR_MARKERS = 72
const MIN_MINOR_TICK_SPACING_PX = 14

// Tick marks rise from the ruler's bottom edge. Majors are taller to read as the
// primary division; both stay short so they don't compete with the playhead/clip
// grid (sized for the ~22px tick lane below the IO lane).
const MAJOR_TICK_HEIGHT = 8
const MINOR_TICK_HEIGHT = 4

// The in/out (IO) bar gets its own lane at the top of the ruler; the tick ruler
// occupies the remaining height below it (mirrors the Color workspace). Exported
// so the ruler playhead can drop its flag below the lane.
export const IO_LANE_HEIGHT = 12

function applyMainTimelineScrubVisual({
  scrollContainer,
  frame,
  maxFrame,
  frameToPixels,
  playheadElements,
}: {
  scrollContainer: HTMLDivElement | null
  frame: number
  maxFrame: number
  frameToPixels: (frame: number) => number
  playheadElements: HTMLElement[]
}): void {
  if (!scrollContainer) return
  const viewportRect = scrollContainer.getBoundingClientRect()
  // Keep the transient visual on the same integer-frame pixel as the committed
  // playhead. Following the raw pointer here makes a stationary click appear to
  // shift on release even when both positions resolve to the same frame.
  const frameTimelineX = Math.round(frameToPixels(frame))
  const visualTimelineX = Math.max(
    scrollContainer.scrollLeft,
    Math.min(
      frameTimelineX,
      scrollContainer.scrollLeft + Math.max(0, viewportRect.width - 1),
      Math.round(frameToPixels(maxFrame)),
    ),
  )
  for (const element of playheadElements) {
    element.style.transform = `translate3d(${visualTimelineX}px, 0, 0)`
  }
  notifyTimelineScrubVisualFrame(scrollContainer, {
    frame,
    source: 'main',
    viewportProgress: getTimelineScrubViewportProgress(
      visualTimelineX - scrollContainer.scrollLeft,
      viewportRect.width - 1,
    ),
  })
}

function applyMainTimelineEdgeScroll(
  scrollContainer: HTMLDivElement | null,
  clientX: number,
  timestamp: number,
  previousTimestamp: number | null,
): number | null {
  if (!scrollContainer) return null
  const viewportRect = scrollContainer.getBoundingClientRect()
  const velocity = getPlayheadEdgeScrollVelocity(clientX, viewportRect)
  const canScroll =
    (velocity < 0 && scrollContainer.scrollLeft > 0) ||
    (velocity > 0 &&
      scrollContainer.scrollLeft + scrollContainer.clientWidth < scrollContainer.scrollWidth)
  if (velocity === 0 || !canScroll) return null

  scrollContainer.scrollLeft += getEdgeScrollDelta(
    velocity,
    timestamp,
    previousTimestamp ?? timestamp - 1000 / 60,
  )
  return timestamp
}

// Quantize pixelsPerSecond for cache keys to avoid redrawing on every minor zoom change
// Uses logarithmic steps for perceptually uniform quantization across zoom range
function quantizePPSForCache(pps: number): number {
  // Use log2 steps of ~5% (factor of 1.05) for smooth visual transitions
  // This gives ~14 cache levels per octave of zoom
  const logStep = Math.log2(1.05)
  const quantizedLog = Math.round(Math.log2(pps) / logStep) * logStep
  return Math.pow(2, quantizedLog)
}

/**
 * Calculate optimal marker interval based on zoom level
 *
 * Thresholds are calibrated for the zoom range (1-200 pps).
 * Labels need ~100px minimum spacing to display timecodes clearly.
 */
function calculateMarkerInterval(pixelsPerSecond: number): MarkerInterval {
  // Frame-level markers (for high zoom levels)
  // At 200 pps: 5 frames = 33px, 10 frames = 67px, 15 frames = 100px
  if (pixelsPerSecond >= 180) {
    // ~100px apart at max zoom - show every 15 frames (0.5 sec at 30fps)
    return { type: 'frame', intervalInSeconds: 15 / 30, minorTicks: 3 }
  }
  if (pixelsPerSecond >= 120) {
    // ~100px apart - show every 25 frames (~0.83 sec)
    return { type: 'frame', intervalInSeconds: 25 / 30, minorTicks: 3 }
  }
  if (pixelsPerSecond >= 80) {
    // 1 second intervals with frame subdivisions
    return { type: 'second', intervalInSeconds: 1, minorTicks: 4 }
  }
  if (pixelsPerSecond >= 50) {
    // 2 second intervals
    return { type: 'multi-second', intervalInSeconds: 2, minorTicks: 2 }
  }
  if (pixelsPerSecond >= 24) {
    return { type: 'multi-second', intervalInSeconds: 5, minorTicks: 2 }
  }
  if (pixelsPerSecond >= 12) {
    return { type: 'multi-second', intervalInSeconds: 10, minorTicks: 2 }
  }
  if (pixelsPerSecond >= 4) {
    return { type: 'multi-second', intervalInSeconds: 30, minorTicks: 3 }
  }
  if (pixelsPerSecond >= 2) {
    return { type: 'minute', intervalInSeconds: 60, minorTicks: 3 }
  }
  if (pixelsPerSecond >= 1) {
    return { type: 'minute', intervalInSeconds: 120, minorTicks: 2 }
  }
  if (pixelsPerSecond >= 0.5) {
    return { type: 'minute', intervalInSeconds: 300, minorTicks: 2 }
  }
  if (pixelsPerSecond >= 0.2) {
    return { type: 'minute', intervalInSeconds: 600, minorTicks: 3 }
  }
  return { type: 'minute', intervalInSeconds: 1800, minorTicks: 2 }
}

/**
 * Draw tick lines on a single tile canvas (labels rendered separately in DOM for crisp text)
 * Takes pre-computed markerConfig to avoid redundant calculations across tiles
 */
function drawTile(
  canvas: HTMLCanvasElement,
  tileIndex: number,
  tileWidth: number,
  canvasHeight: number,
  markerConfig: MarkerInterval,
  timeToPixels: (time: number) => number,
  totalWidth: number,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const tileOffset = tileIndex * tileWidth
  const actualTileWidth = Math.min(tileWidth, totalWidth - tileOffset)

  // Set canvas size with DPI scaling
  canvas.width = Math.ceil(actualTileWidth * dpr)
  canvas.height = Math.ceil(canvasHeight * dpr)
  canvas.style.width = `${actualTileWidth}px`
  canvas.style.height = `${canvasHeight}px`
  ctx.scale(dpr, dpr)

  // Clear
  ctx.clearRect(0, 0, actualTileWidth, canvasHeight)

  // Use pre-computed marker interval (intervalInSeconds is already set correctly in config)
  const intervalInSeconds = markerConfig.intervalInSeconds
  const markerWidthPx = timeToPixels(intervalInSeconds)
  const majorTickTop = canvasHeight - MAJOR_TICK_HEIGHT
  const minorTickTop = canvasHeight - MINOR_TICK_HEIGHT

  if (markerWidthPx <= 0) return

  // Calculate which markers fall within this tile
  // Include one extra marker before tile start to catch minor ticks that extend into the tile
  const startMarkerIndex = Math.max(0, Math.floor(tileOffset / markerWidthPx) - 1)
  const endMarkerIndex = Math.ceil((tileOffset + actualTileWidth) / markerWidthPx)

  // Keep the ruler readable by hiding sub-markers when spacing gets too tight.
  const visibleMarkerCount = endMarkerIndex - startMarkerIndex + 1
  const tickSpacing = markerConfig.minorTicks > 0 ? markerWidthPx / markerConfig.minorTicks : 0
  const showMinorTicks =
    markerConfig.minorTicks > 0 &&
    visibleMarkerCount < MAX_VISIBLE_MINOR_MARKERS &&
    tickSpacing >= MIN_MINOR_TICK_SPACING_PX

  for (let i = startMarkerIndex; i <= endMarkerIndex; i++) {
    const timeInSeconds = i * intervalInSeconds
    const absoluteX = timeToPixels(timeInSeconds)
    const x = absoluteX - tileOffset // Convert to tile-relative coordinate

    // Major tick mark - bottom-anchored, only draw if within tile bounds
    if (x >= 0 && x <= actualTileWidth) {
      const lineX = Math.round(x) + 0.5
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(lineX, majorTickTop)
      ctx.lineTo(lineX, canvasHeight)
      ctx.stroke()
    }

    // Minor ticks - check each tick individually (they may extend from markers outside tile)
    if (showMinorTicks) {
      // Skip if all minor ticks would be outside tile
      const lastTickX = x + tickSpacing * (markerConfig.minorTicks - 1)
      if (lastTickX < 0 || x > actualTileWidth) continue

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)'
      ctx.lineWidth = 1

      for (let j = 1; j < markerConfig.minorTicks; j++) {
        const tickX = Math.round(x + tickSpacing * j) + 0.5
        if (tickX < 0 || tickX > actualTileWidth) continue

        ctx.beginPath()
        ctx.moveTo(tickX, minorTickTop)
        ctx.lineTo(tickX, canvasHeight)
        ctx.stroke()
      }
    }
  }
}

/**
 * DOM labels for timeline ruler - uses quantized PPS to stay in sync with canvas ticks
 * Renders only visible labels with buffer for smooth scrolling
 */
const LABEL_BUFFER = 100 // Extra pixels to render labels outside viewport
const MAX_LABELS = 100

/**
 * Tracks the config that was used to position existing pooled labels.
 * When PPS/FPS haven't changed, labels are absolutely positioned within
 * the scrolling container — their position is stable across scroll. We
 * only need to add/remove labels at the viewport edges, not update all
 * existing ones. When PPS or FPS changes we must update every label.
 */
let _labelConfigPPS = 0
let _labelConfigFPS = 0

/**
 * Imperative label pool — manages timecode `<span>` elements via direct DOM
 * manipulation instead of React reconciliation. Labels are absolutely positioned
 * within the scrolling container so the browser handles scroll offset natively;
 * the pool only adds/removes elements as they enter/leave the visible range.
 *
 * Called from the scroll RAF callback (zero React re-renders on scroll).
 * Also called on zoom/fps changes to rebuild with new intervals.
 *
 * Optimization: during pure scroll (no zoom/fps change), existing labels
 * keep their position — only edge additions/removals mutate the DOM.
 * This cuts ~60 DOM mutations per scroll frame to ~2-4.
 */
function syncLabels(
  container: HTMLDivElement,
  pool: Map<number, HTMLSpanElement>,
  scrollLeft: number,
  viewportWidth: number,
  quantizedPPS: number,
  fps: number,
) {
  const markerConfig = calculateMarkerInterval(quantizedPPS)
  const intervalInSeconds = markerConfig.intervalInSeconds
  const markerWidthPx = intervalInSeconds * quantizedPPS

  if (markerWidthPx <= 0) return

  const configChanged = quantizedPPS !== _labelConfigPPS || fps !== _labelConfigFPS
  if (configChanged) {
    _labelConfigPPS = quantizedPPS
    _labelConfigFPS = fps
  }

  const effectiveViewport = viewportWidth || 1000
  const startPx = Math.max(0, scrollLeft - LABEL_BUFFER)
  const endPx = scrollLeft + effectiveViewport + LABEL_BUFFER

  const startIndex = Math.max(0, Math.floor(startPx / markerWidthPx))
  const endIndex = Math.min(Math.ceil(endPx / markerWidthPx), startIndex + MAX_LABELS)

  const visibleIndices = new Set<number>()

  for (let i = startIndex; i <= endIndex; i++) {
    visibleIndices.add(i)

    let span = pool.get(i)
    const isNew = !span
    if (!span) {
      span = document.createElement('span')
      span.className = 'absolute text-xs text-white/60 select-none whitespace-nowrap'
      span.style.top = '2px'
      span.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      span.style.fontFeatureSettings = '"tnum"'
      span.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.45)'
      span.style.zIndex = '24'
      container.appendChild(span)
      pool.set(i, span)
    }

    // Only set position + text when necessary:
    // - New labels always need it
    // - Config change (PPS/FPS) means existing labels have stale positions
    // During pure scroll, labels are absolutely positioned in the scrolling
    // container so their coordinates are stable — no DOM writes needed.
    if (isNew || configChanged) {
      const timeInSeconds = i * intervalInSeconds
      span.style.left = `${timeInSeconds * quantizedPPS + 6}px`
      span.textContent = formatTimecode(secondsToFrames(timeInSeconds, fps), fps)
    }
  }

  // Remove labels that scrolled out of range
  pool.forEach((span, index) => {
    if (!visibleIndices.has(index)) {
      span.remove()
      pool.delete(index)
    }
  })
}

/** Clear all pooled labels (called on zoom/fps change before rebuilding). */
function clearLabelPool(pool: Map<number, HTMLSpanElement>) {
  pool.forEach((span) => span.remove())
  pool.clear()
}

/**
 * Timeline Markers Component (Tiled Canvas)
 *
 * Uses multiple canvas tiles to avoid browser canvas size limits.
 * Each tile is 2000px wide, only visible tiles are rendered.
 */
export const TimelineMarkers = memo(function TimelineMarkers({
  duration,
  width,
}: TimelineMarkersProps) {
  perfMarkRender('TimelineMarkers')
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const showTimelineHoverPreview = useSettingsStore((s) => s.showTimelineHoverPreview)
  const editorLayout = getEditorLayout(editorDensity)
  const { timeToPixels, frameToPixels, pixelsPerSecond } = useTimelineCommittedZoomContext()
  const fps = useTimelineStore((s) => s.fps)
  const inPoint = useTimelineStore((s) => s.inPoint)
  const outPoint = useTimelineStore((s) => s.outPoint)
  const markDirty = useTimelineStore((s) => s.markDirty)
  const setCurrentFrame = usePlaybackStore((s) => s.setCurrentFrame)
  const setScrubFrame = usePlaybackStore((s) => s.setScrubFrame)
  const pause = usePlaybackStore((s) => s.pause)
  const selectMarker = useSelectionStore((s) => s.selectMarker)

  const containerRef = useRef<HTMLDivElement>(null)
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null)
  // Kept as a fallback for non-layout test environments that do not mount the
  // viewport canvas. The product path always uses rulerCanvasRef.
  const tilesContainerRef = useRef<HTMLDivElement>(null)
  const canvasPoolRef = useRef<Map<number, HTMLCanvasElement>>(new Map())
  // Bitmap cache keyed by "tileIndex-pps-fps-displayWidth" for instant reuse
  const tileCacheRef = useRef<Map<string, ImageBitmap>>(new Map())
  const tileCacheVersionRef = useRef(0)
  const labelsContainerRef = useRef<HTMLDivElement>(null)
  const labelPoolRef = useRef<Map<number, HTMLSpanElement>>(new Map())
  const [viewportWidth, setViewportWidth] = useState(0)
  // scrollLeft is ref-only — never React state. Tile + label updates are
  // driven imperatively from the scroll RAF callback, bypassing React render.
  const [isDragging, setIsDragging] = useState(false)
  const [isRangeDragging, setIsRangeDragging] = useState(false)

  // Refs for drag handlers
  const pixelsToFrameRef = useRef(pixelsToFrameNow)
  const frameToPixelsRef = useRef(frameToPixels)
  const setCurrentFrameRef = useRef(setCurrentFrame)
  const setScrubFrameRef = useRef(setScrubFrame)
  const setPreviewFrameRef = useRef(usePlaybackStore.getState().setPreviewFrame)
  useEffect(() => {
    return usePlaybackStore.subscribe((state) => {
      setPreviewFrameRef.current = state.setPreviewFrame
    })
  }, [])
  const markDirtyRef = useRef(markDirty)
  const pauseRef = useRef(pause)
  const fpsRef = useRef(fps)
  const durationRef = useRef(duration)
  const inPointRef = useRef(inPoint)
  const outPointRef = useRef(outPoint)
  const rangeDragCleanupRef = useRef<(() => void) | null>(null)
  const maxFrame = Math.max(1, Math.floor(duration * fps))
  const sanitizedInOutPoints = useMemo(
    () => sanitizeInOutPoints({ inPoint, outPoint, maxFrame }),
    [inPoint, outPoint, maxFrame],
  )
  const safeInPoint = sanitizedInOutPoints.inPoint
  const safeOutPoint = sanitizedInOutPoints.outPoint

  useEffect(() => {
    frameToPixelsRef.current = frameToPixels
    setCurrentFrameRef.current = setCurrentFrame
    setScrubFrameRef.current = setScrubFrame
    markDirtyRef.current = markDirty
    pauseRef.current = pause
    fpsRef.current = fps
    durationRef.current = duration
    inPointRef.current = safeInPoint
    outPointRef.current = safeOutPoint
  }, [
    frameToPixels,
    setCurrentFrame,
    setScrubFrame,
    markDirty,
    pause,
    fps,
    duration,
    safeInPoint,
    safeOutPoint,
  ])

  useEffect(() => {
    if (safeInPoint === inPoint && safeOutPoint === outPoint) {
      return
    }

    setInOutPointsWithoutHistory(safeInPoint, safeOutPoint)
  }, [inPoint, outPoint, safeInPoint, safeOutPoint])

  // Track viewport and scroll
  const scrollLeftRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const syncRulerScrollRef = useRef<(() => void) | null>(null)
  const hoverPreviewRafRef = useRef<number | null>(null)
  const pendingHoverPreviewFrameRef = useRef<number | null>(null)

  // Unified scrubbing refs (scroll + playhead in same RAF frame)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const scrubMouseClientXRef = useRef<number>(0)
  const scrubRAFIdRef = useRef<number | null>(null)
  const scrubAnimationTimeRef = useRef<number | null>(null)
  const scrubPlayheadElementsRef = useRef<HTMLElement[]>([])
  const skimmerScrubOwnerRef = useRef({})
  const isScrubActiveRef = useRef(false)
  const scrubThrottleStateRef = useRef(createScrubThrottleState())

  useEffect(() => {
    if (!containerRef.current) return

    // Find the actual scroll container (not the sticky parent)
    const scrollContainer = containerRef.current.closest('.timeline-container') as HTMLElement
    if (!scrollContainer) return

    const updateViewport = () => {
      // Measure scroll container - that's the actual viewport
      setViewportWidth(scrollContainer.clientWidth)
    }

    const updateScroll = () => {
      const newScrollLeft = scrollContainer.scrollLeft
      if (newScrollLeft !== scrollLeftRef.current) {
        scrollLeftRef.current = newScrollLeft
        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null
            syncRulerScrollRef.current?.()
          })
        }
      }
    }

    updateViewport()
    scrollLeftRef.current = scrollContainer.scrollLeft
    // Initial sync is deferred to the config-change effect (runs after first render)

    // Observe scroll container for viewport size changes
    const resizeObserver = new ResizeObserver(updateViewport)
    resizeObserver.observe(scrollContainer)
    scrollContainer.addEventListener('scroll', updateScroll, { passive: true })

    return () => {
      resizeObserver.disconnect()
      scrollContainer.removeEventListener('scroll', updateScroll)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
      }
    }
  }, [])

  // Calculate dimensions
  const timelineContentWidth = timeToPixels(duration)
  const displayWidth = width || Math.max(timelineContentWidth, viewportWidth)
  // Ticks live in the lane below the IO bar, so the canvas is the ruler height
  // minus the IO lane.
  const canvasHeight = editorLayout.timelineRulerHeight - IO_LANE_HEIGHT

  // Quantize PPS for cache keys - allows cache reuse across similar zoom levels
  // This dramatically reduces redraws during continuous zoom
  const quantizedPPS = quantizePPSForCache(pixelsPerSecond)

  // Cache key uses quantized PPS for better hit rate during zoom. canvasHeight is
  // included because tile tick geometry is drawn relative to it — without it, a
  // ruler-height change (e.g. a new editor-density preset) would reuse stale tiles.
  const cacheKey = `${quantizedPPS.toFixed(4)}-${fps}-${canvasHeight}`

  // Store config in refs so the imperative scroll handler can access them
  const displayWidthRef = useRef(displayWidth)
  const canvasHeightRef = useRef(canvasHeight)
  const quantizedPPSRef = useRef(quantizedPPS)
  const cacheKeyRef = useRef(cacheKey)
  const viewportWidthRef = useRef(viewportWidth)
  displayWidthRef.current = displayWidth
  canvasHeightRef.current = canvasHeight
  quantizedPPSRef.current = quantizedPPS
  cacheKeyRef.current = cacheKey
  viewportWidthRef.current = viewportWidth

  // Only clear cache when fps changes (rare) - not on zoom changes
  // Individual tiles are keyed by quantized PPS so old tiles naturally become unused
  const prevFpsRef = useRef(fps)
  useEffect(() => {
    if (prevFpsRef.current !== fps) {
      prevFpsRef.current = fps
      tileCacheVersionRef.current++
      const cache = tileCacheRef.current
      cache.forEach((bitmap) => bitmap.close())
      cache.clear()
    }
  }, [fps])

  // Limit cache size to prevent memory bloat (LRU-style: clear oldest when over limit)
  // Reduced from 100 to 50 for memory savings
  const MAX_CACHED_TILES = 50
  useEffect(() => {
    const cache = tileCacheRef.current
    if (cache.size > MAX_CACHED_TILES) {
      // Remove oldest entries (first in map iteration order)
      const entriesToRemove = cache.size - MAX_CACHED_TILES
      let removed = 0
      for (const [key, bitmap] of cache) {
        if (removed >= entriesToRemove) break
        bitmap.close()
        cache.delete(key)
        removed++
      }
    }
  })

  /**
   * Imperative scroll sync — manages canvas tiles AND labels without any
   * React state or re-renders. Called from:
   *  - scroll RAF callback (every scroll frame)
   *  - config change effect (zoom / fps / width)
   *  - initial mount
   */
  const syncRulerScroll = useCallback(() => {
    const rulerCanvas = rulerCanvasRef.current
    if (rulerCanvas) {
      // Remove any legacy pooled nodes retained across a hot reload before the
      // viewport-canvas path took ownership of the ruler.
      canvasPoolRef.current.forEach((canvas) => canvas.remove())
      canvasPoolRef.current.clear()
      clearLabelPool(labelPoolRef.current)
      drawTimelineRulerViewportCanvas({
        canvas: rulerCanvas,
        scrollLeft: scrollLeftRef.current,
        viewportWidth: viewportWidthRef.current,
        canvasHeight: canvasHeightRef.current,
        pixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
        fps: fpsRef.current,
      })
      return
    }

    const tilesContainer = tilesContainerRef.current
    const labelsContainer = labelsContainerRef.current
    if (!tilesContainer) return

    const sl = scrollLeftRef.current
    const vw = viewportWidthRef.current
    const dw = displayWidthRef.current
    const ch = canvasHeightRef.current
    const qPPS = quantizedPPSRef.current
    const ck = cacheKeyRef.current
    if (dw <= 0 || ch <= 0 || qPPS <= 0) return

    // â”€â”€ Tile visibility â”€â”€
    const startTile = Math.max(0, Math.floor(sl / TILE_WIDTH))
    const endTile = Math.min(Math.ceil(dw / TILE_WIDTH) - 1, Math.ceil((sl + vw) / TILE_WIDTH))

    const canvasPool = canvasPoolRef.current
    const tileCache = tileCacheRef.current
    const visibleTileIndices = new Set<number>()
    const dpr = window.devicePixelRatio || 1
    const renderTimeToPixels = (time: number) => time * qPPS
    const markerConfig = calculateMarkerInterval(qPPS)

    // Per-tile cache key. The last (partial) tile's rendered width depends on
    // displayWidth (`dw`), so a duration/viewport change at a fixed zoom would
    // otherwise reuse a stale-width tile (ck alone is width-agnostic). Full
    // tiles always resolve to TILE_WIDTH, so their key stays stable and the
    // zoom-bucket reuse is preserved.
    const tileKeyFor = (idx: number) =>
      `${idx}-${ck}-${Math.round(Math.min(TILE_WIDTH, dw - idx * TILE_WIDTH))}`

    for (let tileIndex = startTile; tileIndex <= endTile; tileIndex++) {
      visibleTileIndices.add(tileIndex)

      let canvas = canvasPool.get(tileIndex)
      if (!canvas) {
        canvas = document.createElement('canvas')
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.pointerEvents = 'none'
        canvas.style.willChange = 'transform'
        canvas.style.transform = `translateX(${tileIndex * TILE_WIDTH}px)`
        canvasPool.set(tileIndex, canvas)
        tilesContainer.appendChild(canvas)
      }
      // Existing canvases keep their transform — tileIndex is stable per pool entry

      const tileCacheKey = tileKeyFor(tileIndex)

      // Skip redraw if this canvas already shows the correct content.
      // data-ck tracks the cache key used for the last successful paint.
      if (canvas.dataset.ck === tileCacheKey) continue

      const cachedBitmap = tileCache.get(tileCacheKey)

      if (cachedBitmap) {
        const tileOffset = tileIndex * TILE_WIDTH
        const actualTileWidth = Math.min(TILE_WIDTH, dw - tileOffset)
        canvas.width = Math.ceil(actualTileWidth * dpr)
        canvas.height = Math.ceil(ch * dpr)
        canvas.style.width = `${actualTileWidth}px`
        canvas.style.height = `${ch}px`
        const ctx = canvas.getContext('2d')
        if (ctx) ctx.drawImage(cachedBitmap, 0, 0)
        canvas.dataset.ck = tileCacheKey
      } else {
        drawTile(canvas, tileIndex, TILE_WIDTH, ch, markerConfig, renderTimeToPixels, dw)
        canvas.dataset.ck = tileCacheKey
        createImageBitmap(canvas)
          .then((bitmap) => {
            if (tileCacheRef.current === tileCache) {
              tileCache.set(tileCacheKey, bitmap)
            } else {
              bitmap.close()
            }
          })
          .catch(() => {})
      }
    }

    // Remove tiles that scrolled out of range
    canvasPool.forEach((canvas, tileIndex) => {
      if (!visibleTileIndices.has(tileIndex)) {
        canvas.remove()
        canvasPool.delete(tileIndex)
      }
    })

    // Pre-render adjacent tiles during idle
    const maxTile = Math.ceil(dw / TILE_WIDTH) - 1
    const adjacentTiles = [startTile - 1, endTile + 1].filter(
      (t) => t >= 0 && t <= maxTile && !tileCache.has(tileKeyFor(t)),
    )
    if (adjacentTiles.length > 0) {
      requestIdleCallback(
        (deadline) => {
          for (const adj of adjacentTiles) {
            if (deadline.timeRemaining() < 10 || tileCacheRef.current !== tileCache) break
            const adjKey = tileKeyFor(adj)
            if (tileCache.has(adjKey)) continue
            const offscreen = document.createElement('canvas')
            drawTile(offscreen, adj, TILE_WIDTH, ch, markerConfig, renderTimeToPixels, dw)
            createImageBitmap(offscreen)
              .then((bitmap) => {
                if (tileCacheRef.current === tileCache) tileCache.set(adjKey, bitmap)
                else bitmap.close()
              })
              .catch(() => {})
          }
        },
        { timeout: 500 },
      )
    }

    // â”€â”€ Labels â”€â”€
    if (labelsContainer) {
      syncLabels(labelsContainer, labelPoolRef.current, sl, vw, qPPS, fpsRef.current)
    }
  }, [])
  syncRulerScrollRef.current = syncRulerScroll

  // Redraw only the small visible tile/label pool at live zoom. Tick spacing
  // and text stay natural because no ruler content is stretched.
  useEffect(() => {
    return useZoomStore.subscribe((state, previousState) => {
      if (state.pixelsPerSecond === previousState.pixelsPerSecond) return

      const livePPS = state.pixelsPerSecond
      const liveQuantizedPPS = quantizePPSForCache(livePPS)
      displayWidthRef.current = Math.max(duration * livePPS, viewportWidthRef.current)
      quantizedPPSRef.current = liveQuantizedPPS
      cacheKeyRef.current = `${liveQuantizedPPS.toFixed(4)}-${fpsRef.current}-${canvasHeightRef.current}`

      if (rafIdRef.current !== null) return
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null
        syncRulerScrollRef.current?.()
      })
    })
  }, [duration])

  // Trigger sync on config changes (zoom, fps, width, height).
  // Labels update in-place (position + text) — no clear needed.
  useEffect(() => {
    syncRulerScroll()
  }, [quantizedPPS, fps, displayWidth, canvasHeight, viewportWidth, syncRulerScroll])

  // Cleanup on unmount
  useEffect(() => {
    const canvasPool = canvasPoolRef.current
    const tileCache = tileCacheRef.current
    const labelPool = labelPoolRef.current
    return () => {
      canvasPool.forEach((canvas) => canvas.remove())
      canvasPool.clear()
      // Clean up cached bitmaps
      tileCache.forEach((bitmap) => bitmap.close())
      tileCache.clear()
      // Clean up label pool
      clearLabelPool(labelPool)
    }
  }, [])

  /**
   * Unified scrub loop - handles BOTH edge scroll AND playhead in same RAF frame
   * This ensures scroll and playhead are always perfectly synchronized
   */
  const runUnifiedScrubLoop = useCallback((timestamp: number) => {
    if (!isScrubActiveRef.current || !containerRef.current) {
      scrubRAFIdRef.current = null
      return
    }

    const scrollContainer = scrollContainerRef.current
    const mouseClientX = scrubMouseClientXRef.current

    // --- STEP 1: Calculate and apply edge scroll ---
    scrubAnimationTimeRef.current = applyMainTimelineEdgeScroll(
      scrollContainer,
      mouseClientX,
      timestamp,
      scrubAnimationTimeRef.current,
    )

    // --- STEP 2: Update playhead with FRESH position ---
    // The ruler itself is the time-axis origin. Its rect already incorporates
    // native scroll, so no additional scrollLeft term belongs in this mapping.
    const x = mouseClientX - containerRef.current.getBoundingClientRect().left

    // Calculate frame (pixel-perfect: round to whole frames)
    const maxFrame = Math.floor(durationRef.current * fpsRef.current)
    const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))

    const nowMs = performance.now()
    if (
      shouldCommitScrubFrame({
        state: scrubThrottleStateRef.current,
        pointerX: x,
        targetFrame: frame,
        pixelsPerSecond: useZoomStore.getState().pixelsPerSecond,
        nowMs,
      })
    ) {
      setScrubFrameRef.current(frame)
    }

    applyMainTimelineScrubVisual({
      scrollContainer,
      frame,
      maxFrame,
      frameToPixels: frameToPixelsNow,
      playheadElements: scrubPlayheadElementsRef.current,
    })

    // --- STEP 3: Continue loop while scrubbing ---
    scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop)
  }, [])

  const getTimelineXFromClientX = useCallback((clientX: number): number => {
    if (!containerRef.current) return 0
    return clientX - containerRef.current.getBoundingClientRect().left
  }, [])

  const getFrameFromClientX = useCallback(
    (clientX: number): number => {
      const x = getTimelineXFromClientX(clientX)
      const maxFrame = Math.floor(durationRef.current * fpsRef.current)
      return Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))
    },
    [getTimelineXFromClientX],
  )

  const handleRulerMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging || isRangeDragging) return
      // The ruler owns this hover. Prevent TimelineContent's bubbling handler
      // from scheduling a second publication for the same pointer sample.
      e.stopPropagation()

      if (!showTimelineHoverPreview) {
        if (hoverPreviewRafRef.current !== null) {
          cancelAnimationFrame(hoverPreviewRafRef.current)
          hoverPreviewRafRef.current = null
        }
        pendingHoverPreviewFrameRef.current = null
        if (usePlaybackStore.getState().previewFrame !== null) {
          setPreviewFrameRef.current(null)
        }
        return
      }

      const frame = getFrameFromClientX(e.clientX)
      pendingHoverPreviewFrameRef.current = frame
      if (hoverPreviewRafRef.current !== null) return
      hoverPreviewRafRef.current = requestAnimationFrame(() => {
        hoverPreviewRafRef.current = null
        const nextFrame = pendingHoverPreviewFrameRef.current
        pendingHoverPreviewFrameRef.current = null
        if (nextFrame !== null) {
          setPreviewFrameRef.current(nextFrame)
        }
      })
    },
    [getFrameFromClientX, isDragging, isRangeDragging, showTimelineHoverPreview],
  )

  useEffect(() => {
    if (showTimelineHoverPreview) return
    if (hoverPreviewRafRef.current !== null) {
      cancelAnimationFrame(hoverPreviewRafRef.current)
      hoverPreviewRafRef.current = null
    }
    pendingHoverPreviewFrameRef.current = null
    if (usePlaybackStore.getState().previewFrame !== null) {
      setPreviewFrameRef.current(null)
    }
  }, [showTimelineHoverPreview])

  const handleRulerMouseLeave = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging || isRangeDragging) return

      const timelineContainer = e.currentTarget.closest('[data-timeline-scroll-container]')
      if (e.relatedTarget instanceof Node && timelineContainer?.contains(e.relatedTarget)) {
        if (hoverPreviewRafRef.current !== null) {
          cancelAnimationFrame(hoverPreviewRafRef.current)
          hoverPreviewRafRef.current = null
        }
        pendingHoverPreviewFrameRef.current = null
        // The parent timeline owns skimming across both its ruler and tracks.
        // Crossing that internal boundary is not a skim release: clearing here
        // briefly retargets the committed frame and cancels compound-frame work
        // before the parent publishes the next hovered frame.
        return
      }

      if (hoverPreviewRafRef.current !== null) {
        cancelAnimationFrame(hoverPreviewRafRef.current)
        hoverPreviewRafRef.current = null
      }
      pendingHoverPreviewFrameRef.current = null
      setPreviewFrameRef.current(null)
    },
    [isDragging, isRangeDragging],
  )

  useEffect(
    () => () => {
      if (hoverPreviewRafRef.current !== null) {
        cancelAnimationFrame(hoverPreviewRafRef.current)
      }
      hoverPreviewRafRef.current = null
      pendingHoverPreviewFrameRef.current = null
    },
    [],
  )

  const handleRangeMouseDown = useCallback(
    (e: React.PointerEvent) => {
      const startIn = inPointRef.current
      const startOut = outPointRef.current
      if (startIn === null || startOut === null) return

      const startTimelineX = getTimelineXFromClientX(e.clientX)
      const rangeTop = e.currentTarget.getBoundingClientRect().top
      const originalCursor = document.body.style.cursor
      let lastIn = startIn
      let lastOut = startOut

      const cleanup = beginIoPointerDrag(
        e,
        (clientX) => {
          const deltaFrames = Math.round(
            pixelsToFrameRef.current(getTimelineXFromClientX(clientX)) -
              pixelsToFrameRef.current(startTimelineX),
          )
          const span = Math.max(1, startOut - startIn)
          const maxIn = Math.max(0, Math.floor(durationRef.current * fpsRef.current) - span)
          const nextIn = Math.max(0, Math.min(startIn + deltaFrames, maxIn))
          const nextOut = nextIn + span
          const label = `${formatTimecodeCompact(nextIn, fpsRef.current)} → ${formatTimecodeCompact(nextOut, fpsRef.current)}`
          const scrollContainer = containerRef.current?.closest(
            '.timeline-container',
          ) as HTMLDivElement | null
          const coordinateBox = scrollContainer ?? containerRef.current
          const coordinateRect = coordinateBox?.getBoundingClientRect()
          const scrollLeft = scrollContainer?.scrollLeft ?? 0
          const rangeLeft = (coordinateRect?.left ?? 0) + frameToPixels(nextIn) - scrollLeft
          const rangeRight = (coordinateRect?.left ?? 0) + frameToPixels(nextOut) - scrollLeft
          const visibleLeft = coordinateRect
            ? Math.max(coordinateRect.left, Math.min(coordinateRect.right, rangeLeft))
            : rangeLeft
          const visibleRight = coordinateRect
            ? Math.max(coordinateRect.left, Math.min(coordinateRect.right, rangeRight))
            : rangeRight
          const readout = {
            label,
            x: (visibleLeft + visibleRight) / 2,
            // The global readout places its bottom 16px above this coordinate;
            // offset by the lane height so it sits just above the body.
            y: rangeTop + IO_LANE_HEIGHT,
          }
          // Skip redundant writes while dragging (still update the readout).
          if (nextIn === lastIn && nextOut === lastOut) return readout
          setInOutPointsWithoutHistory(nextIn, nextOut)
          // Skim the preview to the range's leading (in) edge as it slides.
          setPreviewFrameRef.current(nextIn)
          lastIn = nextIn
          lastOut = nextOut
          return readout
        },
        () => {
          document.body.style.cursor = originalCursor
          previewScrubberSuppressRef.current = false
          setPreviewFrameRef.current(null)
          markDirtyRef.current()
          setIsRangeDragging(false)
          rangeDragCleanupRef.current = null
        },
      )
      if (!cleanup) return
      document.body.style.cursor = 'move'
      // Keep the preview canvas refreshing but pin the ghost skimmer so it
      // doesn't chase the range as it slides (matches the Color workspace).
      previewScrubberSuppressRef.current = true
      setIsRangeDragging(true)
      rangeDragCleanupRef.current = cleanup
    },
    [frameToPixels, getTimelineXFromClientX],
  )

  // Scrubbing handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation() // Prevent click from bubbling to container and clearing selection
      if (!containerRef.current) return

      // Seeking is disabled during a voiceover take — moving the playhead
      // without moving the mic audio would desync the recording irreparably.
      if (isMicRecordingActive(useMicRecordingStore.getState().status)) return

      // Clear marker selection when clicking on ruler (only if a marker is selected)
      const { selectedMarkerId } = useSelectionStore.getState()
      if (selectedMarkerId) {
        selectMarker(null)
      }

      // Cache scroll container for edge-scrolling
      scrollContainerRef.current = containerRef.current.closest(
        '.timeline-container',
      ) as HTMLDivElement | null
      scrubPlayheadElementsRef.current = scrollContainerRef.current
        ? Array.from(
            scrollContainerRef.current.querySelectorAll<HTMLElement>('[data-timeline-playhead]'),
          )
        : []

      // Initialize unified scrub state
      scrubMouseClientXRef.current = e.clientX
      scrubAnimationTimeRef.current = null
      isScrubActiveRef.current = true
      mainTimelineScrubActiveRef.current = true
      beginTimelineSkimmerScrub(skimmerScrubOwnerRef.current)

      pauseRef.current()

      // Immediate frame update on click using the ruler's time-axis origin.
      const x = e.clientX - containerRef.current.getBoundingClientRect().left
      const maxFrame = Math.floor(durationRef.current * fpsRef.current)
      const frame = Math.min(maxFrame, Math.max(0, Math.round(pixelsToFrameRef.current(x))))
      setScrubFrameRef.current(frame)
      applyMainTimelineScrubVisual({
        scrollContainer: scrollContainerRef.current,
        frame,
        maxFrame,
        frameToPixels: frameToPixelsNow,
        playheadElements: scrubPlayheadElementsRef.current,
      })
      scrubThrottleStateRef.current = createScrubThrottleState({
        pointerX: x,
        frame,
        nowMs: performance.now(),
      })

      setIsDragging(true)

      // Start unified RAF loop
      if (scrubRAFIdRef.current === null) {
        scrubRAFIdRef.current = requestAnimationFrame(runUnifiedScrubLoop)
      }
    },
    [selectMarker, runUnifiedScrubLoop],
  )

  useEffect(() => {
    if (!isDragging) return
    const skimmerScrubOwner = skimmerScrubOwnerRef.current

    const originalCursor = document.body.style.cursor
    document.body.style.cursor = 'ew-resize'

    const handleMouseMove = (e: MouseEvent) => {
      // Just store position - the unified RAF loop handles everything else
      scrubMouseClientXRef.current = e.clientX
    }

    const handleMouseUp = () => {
      // Stop the unified scrub loop
      isScrubActiveRef.current = false
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current)
        scrubRAFIdRef.current = null
      }
      const finalFrame = getFrameFromClientX(scrubMouseClientXRef.current)
      setScrubFrameRef.current(finalFrame)
      const finalTimelineX = Math.round(frameToPixelsNow(finalFrame))
      for (const element of scrubPlayheadElementsRef.current) {
        element.style.transform = `translate3d(${finalTimelineX}px, 0, 0)`
      }
      scrubAnimationTimeRef.current = null
      scrubPlayheadElementsRef.current = []
      setIsDragging(false)
      setPreviewFrameRef.current(null)
      // Clear after the preview notification so linked playheads retain the
      // final frame while their slower React props catch up.
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('blur', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('blur', handleMouseUp)
      document.body.style.cursor = originalCursor
      // Ensure cleanup
      isScrubActiveRef.current = false
      mainTimelineScrubActiveRef.current = false
      endTimelineSkimmerScrub(skimmerScrubOwner)
      if (scrubRAFIdRef.current !== null) {
        cancelAnimationFrame(scrubRAFIdRef.current)
        scrubRAFIdRef.current = null
      }
      scrubAnimationTimeRef.current = null
      scrubPlayheadElementsRef.current = []
    }
  }, [getFrameFromClientX, isDragging])

  // Tear down an in-flight range drag if the component unmounts mid-gesture.
  useEffect(() => () => rangeDragCleanupRef.current?.(), [])

  return (
    <div
      ref={containerRef}
      className="border-b border-border/80 relative"
      onMouseDown={handleMouseDown}
      onMouseMove={handleRulerMouseMove}
      onMouseLeave={handleRulerMouseLeave}
      style={{
        background: 'oklch(0.22 0 0 / 0.22)',
        userSelect: 'none',
        cursor: 'ew-resize',
        height: EDITOR_LAYOUT_CSS_VALUES.timelineRulerHeight,
        width: width ? `${width}px` : undefined,
        minWidth: width ? `${width}px` : undefined,
      }}
    >
      {/* Tiled canvas container (tick lines only) — below the IO lane */}
      <div
        className="absolute left-0 right-0 bottom-0 pointer-events-none"
        style={{ top: IO_LANE_HEIGHT }}
      >
        <canvas
          ref={rulerCanvasRef}
          data-main-timeline-ruler-canvas
          aria-hidden="true"
          className="sticky left-0 block pointer-events-none text-[10px] text-muted-foreground"
          style={{
            width: viewportWidth || undefined,
            height: canvasHeight,
            contain: 'layout paint',
          }}
        />
      </div>

      {/* Imperative label pool — managed by syncRulerScroll, zero React re-renders on scroll */}
      {/* IO lane backdrop + divider so the in/out bar reads as its own track
          rather than floating over the ruler ticks. */}
      <div
        className="absolute left-0 right-0 top-0 border-b border-border/70 bg-black/25 pointer-events-none"
        style={{ height: IO_LANE_HEIGHT, zIndex: 8 }}
      />

      {/* Draggable in/out strip — its own lane at the top of the ruler */}
      {safeInPoint !== null && safeOutPoint !== null && (
        <IoRangeStrip
          left={`${frameToPixels(safeInPoint)}px`}
          width={`${frameToPixels(safeOutPoint) - frameToPixels(safeInPoint)}px`}
          height={IO_LANE_HEIGHT}
          className="cursor-move active:cursor-move"
          onDragStart={handleRangeMouseDown}
          testId="edit-timeline-io-strip"
        />
      )}

      {/* In/Out markers (DOM - only 2 elements) */}
      <TimelineInOutMarkers />

      {/* Project markers (DOM - minimal count) */}
      <TimelineProjectMarkers />
    </div>
  )
})
