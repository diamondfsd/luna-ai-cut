/**
 * Adapter exports for preview dependencies.
 * Export modules should import preview utilities from here.
 */

export { ScrubbingCache } from '@freecut/features/preview/utils/scrubbing-cache'
export { getCachedPredecodedBitmap } from '@freecut/features/preview/utils/decoder-prewarm'
export { getCachedActivePreviewFallbackBitmap } from '@freecut/features/preview/utils/decoder-prewarm'
export { isActivePreviewTargetSuperseded } from '@freecut/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameSuperseded } from '@freecut/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameCurrent } from '@freecut/features/preview/utils/decoder-prewarm'
export { isActivePreviewFrameDecodeReady } from '@freecut/features/preview/utils/decoder-prewarm'
export { isActivePreviewSourceTarget } from '@freecut/features/preview/utils/decoder-prewarm'
export { waitForInflightPredecodedBitmap } from '@freecut/features/preview/utils/decoder-prewarm'
