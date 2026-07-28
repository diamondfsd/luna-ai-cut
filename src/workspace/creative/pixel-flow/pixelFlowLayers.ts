import type { PreviewLayer, WorkspaceMediaAsset, WorkspacePixelFlowState } from '../../../shared/types'

export type PixelFlowEffectSettings = Pick<WorkspacePixelFlowState,
  'duration' | 'pixelCount' | 'lightWidth' | 'initialSaturation' | 'initialBrightness'
  | 'subjectDirection' | 'rainSpeed' | 'rainLength' | 'flowStrength' | 'subjectDelay'
  | 'bloomStrength' | 'filterStrength' | 'colorTransition'>

export function buildPixelFlowLayer(options: {
  asset: WorkspaceMediaAsset
  maskPath?: string
  playbackDuration: number
  settings: PixelFlowEffectSettings
}): PreviewLayer {
  const { asset, maskPath, playbackDuration, settings } = options
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
    maskPath,
    pixelFlow: {
      ...settings,
      segmented: Boolean(maskPath),
    },
  }
}
