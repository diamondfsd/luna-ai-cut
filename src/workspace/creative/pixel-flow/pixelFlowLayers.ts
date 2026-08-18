import type { PreviewLayer, WorkspaceMediaAsset, WorkspacePixelFlowState } from '../../../shared/types'
import type { EditPipeline } from '../../shared/editPipeline'
import { pipelineColorToRenderColor } from '../../shared/renderLayerPipeline'

export type PixelFlowEffectSettings = Pick<WorkspacePixelFlowState,
  'duration' | 'pixelCount' | 'lightWidth' | 'initialSaturation' | 'initialBrightness'
  | 'subjectDirection' | 'rainSpeed' | 'rainLength' | 'flowStrength' | 'subjectDelay'
  | 'bloomStrength' | 'filterStrength' | 'colorTransition'>

export function buildPixelFlowLayer(options: {
  asset: WorkspaceMediaAsset
  maskProjectId?: string
  maskPath?: string
  playbackDuration: number
  pipeline: EditPipeline
  settings: PixelFlowEffectSettings
}): PreviewLayer {
  const { asset, maskProjectId, maskPath, pipeline, playbackDuration, settings } = options
  return {
    layerType: 'pixel-flow',
    filePath: asset.path,
    isVideo: asset.kind === 'video',
    videoTime: 0,
    videoDuration: asset.kind === 'video' ? playbackDuration : undefined,
    fit: 'stretch',
    dstX: 0,
    dstY: 0,
    dstW: 1,
    dstH: 1,
    srcX: 0,
    srcY: 0,
    srcW: 1,
    srcH: 1,
    opacity: 1,
    zIndex: 0,
    color: pipelineColorToRenderColor(pipeline.color),
    restoreLutId: pipeline.logRestore.activeId ?? undefined,
    lutId: pipeline.lutFilter.activeId ?? undefined,
    lutIntensity: pipeline.lutFilter.intensity,
    maskProjectId,
    maskPath,
    pixelFlow: {
      ...settings,
      segmented: Boolean(maskPath),
    },
  }
}
