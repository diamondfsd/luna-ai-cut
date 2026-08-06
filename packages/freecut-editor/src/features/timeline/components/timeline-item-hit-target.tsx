import { memo } from 'react'
import type { TimelineItem } from '@freecut/types/timeline'

interface TimelineItemHitTargetProps {
  item: TimelineItem
  trackLocked: boolean
  onHoverChange: (itemId: string, hovered: boolean) => void
}

function getFramePositionStyle(frame: number): string {
  return `calc(${frame} * var(--timeline-percent-per-frame, 0%))`
}

export const TimelineItemHitTarget = memo(function TimelineItemHitTarget({
  item,
  trackLocked,
  onHoverChange,
}: TimelineItemHitTargetProps) {
  return (
    <div
      data-item-id={item.id}
      data-timeline-hit-target="true"
      aria-label={item.label}
      className="absolute inset-y-px rounded bg-transparent"
      style={{
        left: getFramePositionStyle(item.from),
        width: getFramePositionStyle(item.durationInFrames),
        cursor: trackLocked ? 'not-allowed' : 'default',
        contain: 'layout style paint',
        zIndex: 1,
      }}
      onMouseEnter={() => onHoverChange(item.id, true)}
      onDragEnter={() => onHoverChange(item.id, true)}
      onContextMenu={() => onHoverChange(item.id, true)}
    />
  )
})
