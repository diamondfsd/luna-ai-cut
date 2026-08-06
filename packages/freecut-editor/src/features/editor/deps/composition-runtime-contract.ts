/**
 * Adapter exports for composition-runtime dependencies.
 * Editor modules should import composition-runtime modules from here.
 */

export {
  type AudioSegment,
  type CompoundAudioSegment,
  type VideoAudioSegment,
} from '@freecut/runtime/composition-runtime/utils/audio-scene'
export {
  buildCompoundAudioTransitionSegments,
  buildStandaloneAudioSegments,
  buildTransitionVideoAudioSegments,
} from '@freecut/runtime/composition-runtime/utils/audio-scene'
export { resolveCompositionRenderPlan } from '@freecut/runtime/composition-runtime/utils/scene-assembly'
export {
  resolveTransform,
  getSourceDimensions,
} from '@freecut/runtime/composition-runtime/utils/transform-resolver'
export { resolveItemTransformAtFrame } from '@freecut/runtime/composition-runtime/utils/frame-scene'
export {
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  withCornerPinReferenceSize,
} from '@freecut/runtime/composition-runtime/utils/corner-pin'
export { clearPreviewAudioCache } from '@freecut/runtime/composition-runtime/utils/audio-decode-cache'
export { deletePreviewAudioConform } from '@freecut/runtime/composition-runtime/utils/preview-audio-conform'
