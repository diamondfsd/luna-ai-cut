/**
 * Adapter exports for export dependencies.
 * Preview modules should import export utilities from here.
 */

export {
  SharedVideoExtractorPool,
  type VideoFrameSource,
} from '@freecut/features/export/utils/shared-video-extractor'
export {
  isFrameInsideSourceTimeRamp,
  resolveAATransitionRamps,
  resolveTransitionRenderTimelineSpan,
  resolveVideoRenderSourceTimeSeconds,
} from '@freecut/features/export/utils/render-span'

export type CreateCompositionRenderer =
  (typeof import('@freecut/features/export/utils/client-render-engine'))['createCompositionRenderer']
export type CompositionRendererInstance = Awaited<ReturnType<CreateCompositionRenderer>>

export const importCompositionRenderer = () =>
  import('@freecut/features/export/utils/client-render-engine')
