/**
 * Adapter exports for composition-runtime dependencies.
 * Preview modules should import composition-runtime modules from here.
 */

export { MainComposition } from '@freecut/runtime/composition-runtime/compositions/main-composition'
export {
  resolveTransform,
  getSourceDimensions,
} from '@freecut/runtime/composition-runtime/utils/transform-resolver'
export { resolveItemTransformAtFrame } from '@freecut/runtime/composition-runtime/utils/frame-scene'
export type { PreviewPathVerticesOverride } from '@freecut/runtime/composition-runtime/utils/preview-path-override'
export { expandTextTransformToFitContent } from '@freecut/runtime/composition-runtime/utils/text-layout'
export {
  computeCornerPinHomography,
  invertCornerPinHomography,
  hasCornerPin,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
  withCornerPinReferenceSize,
} from '@freecut/runtime/composition-runtime/utils/corner-pin'
export { getBestDomVideoElementForItem } from '@freecut/runtime/composition-runtime/utils/dom-video-element-registry'
export {
  getVideoTargetTimeSeconds,
  snapSourceTime,
} from '@freecut/runtime/composition-runtime/utils/video-timing'
export { resolveTrackRenderState } from '@freecut/runtime/composition-runtime/utils/scene-assembly'
export {
  ensureAudioContextResumed,
  getPreviewAudioContextState,
  transitionSafePlay,
} from '@freecut/runtime/composition-runtime/components/video-audio-context'
