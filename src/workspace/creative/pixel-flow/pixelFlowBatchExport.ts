import type { VideoExportSettings, WorkspaceMediaAsset, WorkspacePixelFlowState, WorkspaceProject } from '../../../shared/types'
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { resolvePixelFlowBatchMask } from './pixelFlowBatchMask'
import { queuePixelFlowExports } from './pixelFlowExport'
import { buildPixelFlowLayer, type PixelFlowEffectSettings } from './pixelFlowLayers'
import { PIXEL_FLOW_SETTINGS_VERSION } from './pixelFlowPresets'
import { pixelFlowStateForAsset } from './pixelFlowState'

interface PixelFlowBatchExportOptions {
  project: WorkspaceProject
  assets: WorkspaceMediaAsset[]
  config: VideoExportSettings
  settings: PixelFlowEffectSettings
  onProgress?: (label: string) => void
}

export interface PixelFlowBatchExportResult {
  queuedCount: number
  failedCount: number
  resolvedStates: Record<string, WorkspacePixelFlowState>
}

export async function queuePixelFlowBatchExport(options: PixelFlowBatchExportOptions): Promise<PixelFlowBatchExportResult> {
  const liveFormats = options.config.exportFormats.filter((format) => format !== 'video')
  const videoSelected = options.config.exportFormats.includes('video')
  const assets = options.assets.filter((asset) => asset.kind === 'image'
    ? videoSelected || liveFormats.length > 0
    : videoSelected)
  if (assets.length === 0) throw new Error('请选择与素材类型对应的导出格式')

  const prepared: Array<{
    asset: WorkspaceMediaAsset
    sourceSize: { width: number; height: number }
    playbackDuration: number
    state: WorkspacePixelFlowState
  }> = []
  const resolvedStates: Record<string, WorkspacePixelFlowState> = {}
  let failedCount = 0

  for (const [index, asset] of assets.entries()) {
    options.onProgress?.(`准备 ${index + 1}/${assets.length}`)
    try {
      const [mask, sourceSize, mediaDuration] = await Promise.all([
        resolvePixelFlowBatchMask({
          projectId: options.project.id,
          asset,
          savedState: pixelFlowStateForAsset(options.project, asset.id),
          api: {
            loadMask: (projectId, path) => window.luna.workspace.loadColorMask(projectId, path),
            segment: (request) => window.luna.workspace.segmentImage(request),
            saveMask: (projectId, assetId, width, height, bytes) => (
              window.luna.workspace.saveColorMask(projectId, assetId, width, height, bytes, 1)
            ),
          },
        }),
        asset.kind === 'image'
          ? loadCreativeImageSize(asset)
          : window.luna.workspace.getMediaResolution(asset.path),
        asset.kind === 'video'
          ? window.luna.workspace.getVideoDuration(asset.path)
          : Promise.resolve(options.settings.duration),
      ])
      const state: WorkspacePixelFlowState = {
        ...options.settings,
        settingsVersion: PIXEL_FLOW_SETTINGS_VERSION,
        maskPath: mask.maskPath,
        skyMaskPath: mask.skyMaskPath,
        depthMaskPath: mask.depthMaskPath,
        maskAssetId: asset.id,
      }
      resolvedStates[asset.id] = state
      prepared.push({ asset, sourceSize, playbackDuration: mediaDuration, state })
    } catch {
      failedCount += 1
    }
  }

  const queuedCount = await queuePixelFlowExports(prepared.map((item) => {
    const layers = [buildPixelFlowLayer({
        asset: item.asset,
        maskPath: item.state.depthMaskPath!,
        playbackDuration: item.playbackDuration,
        settings: item.state,
    })]
    return {
      asset: item.asset,
      layers,
      sourceSize: item.sourceSize,
      playbackDuration: item.playbackDuration,
      config: {
        ...options.config,
        exportFormats: item.asset.kind === 'image'
          ? options.config.exportFormats
          : ['video'] as VideoExportSettings['exportFormats'],
      },
    }
  }))

  return { queuedCount, failedCount, resolvedStates }
}
