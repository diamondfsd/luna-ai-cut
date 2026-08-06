/**
 * Adapter exports for composition-runtime dependencies.
 * Timeline modules should import composition-runtime utilities from here.
 */

export {
  resolveTransform,
  getSourceDimensions,
} from '@freecut/runtime/composition-runtime/utils/transform-resolver'
export {
  resolveItemTransformAtFrame,
  resolveItemTransformAtRelativeFrame,
} from '@freecut/runtime/composition-runtime/utils/frame-scene'
export { resolveCornerPinTargetRect } from '@freecut/runtime/composition-runtime/utils/corner-pin'
export { needsCustomAudioDecoder } from '@freecut/runtime/composition-runtime/utils/audio-codec-detection'
export {
  getOrDecodeAudio,
  getOrDecodeAudioSliceForPlayback,
  startPreviewAudioConform,
  startPreviewAudioStartupWarm,
} from '@freecut/runtime/composition-runtime/utils/audio-decode-cache'
export { resolvePreviewAudioConformUrl } from '@freecut/runtime/composition-runtime/utils/preview-audio-conform'
export { prewarmPreviewAudioElement } from '@freecut/runtime/composition-runtime/utils/preview-audio-element-pool'
