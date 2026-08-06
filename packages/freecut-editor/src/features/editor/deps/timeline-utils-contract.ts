/**
 * Adapter exports for timeline utility dependencies.
 * Editor modules should import timeline utility helpers from here.
 */

export { createClassicTrack, getTrackKind } from '@freecut/features/timeline/utils/classic-tracks'
export {
  createDefaultAdjustmentItem,
  createDefaultGradientItem,
  createDefaultShapeItem,
  createDefaultSolidColorItem,
  createTextTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
} from '@freecut/features/timeline/utils/generated-layer-items'
export { createOverlayLayerTrack } from '@freecut/features/timeline/utils/new-track-zone-media'
export { createScrubThrottleState, shouldCommitScrubFrame } from '@freecut/features/timeline/utils/scrub-throttle'
export { findCompatibleTrackForItemType } from '@freecut/features/timeline/utils/track-item-compatibility'
export { findNearestAvailableSpace } from '@freecut/features/timeline/utils/collision-utils'
export { resolveEffectiveTrackStates } from '@freecut/features/timeline/utils/group-utils'
export { getMaxTransitionDurationForHandles } from '@freecut/features/timeline/utils/transition-utils'
export { resolveTransitionTargetFromSelection } from '@freecut/features/timeline/utils/transition-targets'
export { searchTimelineTranscript } from '@freecut/features/timeline/utils/transcript-search'
export type { TranscriptSearchMatch } from '@freecut/features/timeline/utils/transcript-search'
export { timelineToSourceFrames, sourceToTimelineFrames } from '@freecut/features/timeline/utils/source-calculations'
export { linkItems } from '@freecut/features/timeline/stores/actions/item-actions'
