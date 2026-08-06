/**
 * Adapter exports for timeline dependencies.
 * Keyframes modules should import timeline stores from here.
 */

export { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store'
export { useItemsStore } from '@freecut/features/timeline/stores/items-store'
export { useKeyframesStore } from '@freecut/features/timeline/stores/keyframes-store'
export { useTransitionsStore } from '@freecut/features/timeline/stores/transitions-store'
export {
  getEdgeScrollDelta,
  getPlayheadEdgeScrollVelocity,
} from '@freecut/features/timeline/utils/playhead-edge-scroll'
