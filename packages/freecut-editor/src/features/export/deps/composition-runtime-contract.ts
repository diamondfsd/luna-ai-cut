/**
 * Adapter exports for composition-runtime dependencies.
 * Export modules should import composition-runtime utilities from here.
 */

export {
  createFrameCompositionSceneCache,
  resolveItemTransformAtFrame,
  resolveActiveShapeMasksAtFrame,
} from '@freecut/runtime/composition-runtime/utils/frame-scene'
export {
  applyPreviewPathVerticesToItem,
  applyPreviewPathVerticesToShape,
  type PreviewPathVerticesOverride,
} from '@freecut/runtime/composition-runtime/utils/preview-path-override'
export { expandTextTransformToFitContent } from '@freecut/runtime/composition-runtime/utils/text-layout'
export {
  resolveCompositionRenderPlan,
  resolveLiveTransitionRenderPlan,
  collectFrameVideoCandidates,
  resolveFrameRenderScene,
  resolveTrackRenderState,
} from '@freecut/runtime/composition-runtime/utils/scene-assembly'
export type { FrameRenderTask } from '@freecut/runtime/composition-runtime/utils/scene-assembly'
export { getShapePath, rotatePath } from '@freecut/runtime/composition-runtime/utils/shape-path'
export {
  hasCornerPin,
  computeCornerPinHomography,
  invertCornerPinHomography,
  drawCornerPinImage,
  computeProjectiveCornerPinWarp,
  resolveCornerPinTargetRect,
  resolveCornerPinForSize,
} from '@freecut/runtime/composition-runtime/utils/corner-pin'
export { getVideoTargetTimeSeconds } from '@freecut/runtime/composition-runtime/utils/video-timing'
