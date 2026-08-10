import type { TimelineItem } from '@freecut/types/timeline'

export interface TimelineCanvasClipRect {
  left: number
  top: number
  width: number
  height: number
  right: number
  bottom: number
}

interface TimelineCanvasClipPalette {
  fill: string
  stroke: string
  labelFill: string
  text: string
}

const LABEL_ROW_HEIGHT = 18
const LABEL_HORIZONTAL_PADDING = 5

const DEFAULT_PALETTE: TimelineCanvasClipPalette = {
  fill: 'rgba(71, 85, 105, 0.92)',
  stroke: 'rgba(148, 163, 184, 0.7)',
  labelFill: 'rgba(15, 23, 42, 0.42)',
  text: 'rgba(248, 250, 252, 0.92)',
}

const PALETTE_BY_TYPE: Partial<Record<TimelineItem['type'], TimelineCanvasClipPalette>> = {
  video: {
    fill: 'rgba(51, 65, 85, 0.96)',
    stroke: 'rgba(100, 116, 139, 0.82)',
    labelFill: 'rgba(15, 23, 42, 0.48)',
    text: 'rgba(248, 250, 252, 0.94)',
  },
  audio: {
    fill: 'rgba(39, 31, 49, 0.96)',
    stroke: 'rgba(126, 107, 145, 0.7)',
    labelFill: 'rgba(15, 13, 20, 0.48)',
    text: 'rgba(241, 245, 249, 0.9)',
  },
  image: {
    fill: 'rgba(37, 99, 235, 0.34)',
    stroke: 'rgba(96, 165, 250, 0.82)',
    labelFill: 'rgba(30, 64, 175, 0.34)',
    text: 'rgba(239, 246, 255, 0.96)',
  },
  html: {
    fill: 'rgba(8, 145, 178, 0.36)',
    stroke: 'rgba(34, 211, 238, 0.82)',
    labelFill: 'rgba(21, 94, 117, 0.4)',
    text: 'rgba(236, 254, 255, 0.96)',
  },
  text: {
    fill: 'rgba(163, 163, 163, 0.34)',
    stroke: 'rgba(212, 212, 212, 0.72)',
    labelFill: 'rgba(64, 64, 64, 0.32)',
    text: 'rgba(250, 250, 250, 0.94)',
  },
  shape: {
    fill: 'rgba(249, 115, 22, 0.34)',
    stroke: 'rgba(251, 146, 60, 0.84)',
    labelFill: 'rgba(154, 52, 18, 0.3)',
    text: 'rgba(255, 247, 237, 0.96)',
  },
  adjustment: {
    fill: 'rgba(168, 85, 247, 0.34)',
    stroke: 'rgba(192, 132, 252, 0.84)',
    labelFill: 'rgba(88, 28, 135, 0.34)',
    text: 'rgba(250, 245, 255, 0.96)',
  },
  composition: {
    fill: 'rgba(124, 58, 237, 0.4)',
    stroke: 'rgba(167, 139, 250, 0.86)',
    labelFill: 'rgba(76, 29, 149, 0.38)',
    text: 'rgba(245, 243, 255, 0.96)',
  },
}

export function getTimelineCanvasClipPalette(itemType: TimelineItem['type']) {
  return PALETTE_BY_TYPE[itemType] ?? DEFAULT_PALETTE
}

export function getTimelineCanvasClipRect({
  item,
  fps,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
}: {
  item: Pick<TimelineItem, 'from' | 'durationInFrames'>
  fps: number
  pixelsPerSecond: number
  scrollLeft: number
  trackHeight: number
}): TimelineCanvasClipRect {
  const pxPerFrame = fps > 0 ? pixelsPerSecond / fps : 0
  const left = item.from * pxPerFrame - scrollLeft
  const width = Math.max(1, item.durationInFrames * pxPerFrame)
  const top = 1
  const height = Math.max(1, trackHeight - 2)
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

export function isTimelineCanvasClipVisible(
  rect: TimelineCanvasClipRect,
  viewportWidth: number,
): boolean {
  return rect.right >= 0 && rect.left <= viewportWidth
}

function drawTimelineCanvasClip({
  context,
  item,
  rect,
  viewportWidth,
}: {
  context: CanvasRenderingContext2D
  item: TimelineItem
  rect: TimelineCanvasClipRect
  viewportWidth: number
}): boolean {
  const left = Math.max(-1, rect.left)
  const right = Math.min(viewportWidth + 1, rect.right)
  const visibleWidth = Math.max(0, right - left)
  if (visibleWidth <= 0) return false

  const palette = getTimelineCanvasClipPalette(item.type)
  context.fillStyle = palette.fill
  context.fillRect(left, rect.top, visibleWidth, rect.height)
  context.strokeStyle = palette.stroke
  context.lineWidth = 1
  context.strokeRect(left + 0.5, rect.top + 0.5, Math.max(0, visibleWidth - 1), rect.height - 1)

  if (visibleWidth >= 20) {
    const labelHeight = Math.min(LABEL_ROW_HEIGHT, rect.height)
    context.fillStyle = palette.labelFill
    context.fillRect(left + 1, rect.top + 1, Math.max(0, visibleWidth - 2), labelHeight)

    if (visibleWidth >= 32) {
      context.save()
      context.beginPath()
      context.rect(
        left + LABEL_HORIZONTAL_PADDING,
        rect.top,
        Math.max(0, visibleWidth - LABEL_HORIZONTAL_PADDING * 2),
        labelHeight,
      )
      context.clip()
      context.fillStyle = palette.text
      context.fillText(
        item.label,
        left + LABEL_HORIZONTAL_PADDING,
        rect.top + labelHeight / 2 + 0.5,
      )
      context.restore()
    }
  }

  return true
}

export function drawInactiveTimelineCanvasItems({
  context,
  items,
  promotedItemIds,
  fps,
  pixelsPerSecond,
  scrollLeft,
  trackHeight,
  viewportWidth,
}: {
  context: CanvasRenderingContext2D
  items: ReadonlyArray<TimelineItem>
  promotedItemIds: ReadonlySet<string>
  fps: number
  pixelsPerSecond: number
  scrollLeft: number
  trackHeight: number
  viewportWidth: number
}): number {
  let renderedItemCount = 0
  for (const item of items) {
    if (promotedItemIds.has(item.id)) continue

    const rect = getTimelineCanvasClipRect({
      item,
      fps,
      pixelsPerSecond,
      scrollLeft,
      trackHeight,
    })
    if (!isTimelineCanvasClipVisible(rect, viewportWidth)) continue
    if (drawTimelineCanvasClip({ context, item, rect, viewportWidth })) {
      renderedItemCount += 1
    }
  }
  return renderedItemCount
}
