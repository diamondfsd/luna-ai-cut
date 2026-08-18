/**
 * Single import seam for preview -> timeline dependencies.
 */

export type { DroppableMediaType, SubComposition } from '@freecut/features/timeline/contracts/preview'
export {
  buildDroppedMediaTimelineItem,
  createOverlayLayerTrack,
  createTimelineTemplateItem,
  getDefaultGeneratedLayerDurationInFrames,
  isTimelineTemplateDragData,
  buildSubCompositionInput,
  buildSubCompositionPreviewSignature,
  createClassicTrack,
  createScrubThrottleState,
  findBestCanvasDropPlacement,
  getDroppedMediaDurationInFrames,
  getSynchronizedLinkedItems,
  getTrackKind,
  performInsertEdit,
  performOverwriteEdit,
  resolveEffectiveTrackStates,
  resolveSourceEditTrackTargets,
  shouldCommitScrubFrame,
  timelineToSourceFrames,
  useCompositionNavigationStore,
  useCompositionsStore,
  useItemsStore,
  useKeyframesStore,
  useLinkedEditPreviewStore,
  useMediaDependencyStore,
  useRippleEditPreviewStore,
  useRollingEditPreviewStore,
  useSlideEditPreviewStore,
  useSlipEditPreviewStore,
  useTransitionResizePreviewStore,
  useTrimPreviewStore,
  useTimelineSettingsStore,
  useTimelineStore,
  useTimelineViewportStore,
  useTransitionsStore,
  useWaveform,
} from '@freecut/features/timeline/contracts/preview'

export const importFilmstripCache = () => import('@freecut/features/timeline/services/filmstrip-cache')
