import { exportPreviewVideo, resolveExportConfig } from '../../../components/previewStageExport'
import type { VideoExportSettings, WorkspaceMediaAsset } from '../../../shared/types'
import type { EditPipeline } from '../../shared/editPipeline'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { canUseLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import { usesCustomWatermark } from '../../../shared/watermarkGeometry'
import { colorRevealCreativeDuration, colorRevealTransitionMax, IMAGE_CREATIVE_DURATION } from './colorRevealConfig'
import { buildColorRevealLayers } from './colorRevealLayers'

export interface ColorRevealExportSource {
  asset: WorkspaceMediaAsset
  pipeline: EditPipeline
}

interface ColorRevealBatchExportOptions {
  sources: ColorRevealExportSource[]
  exportDir: string
  config: VideoExportSettings
  saturation: number
  gray: number
  transitionDuration: number
  initialHoldDuration: number
  midpointHoldDuration: number
  stageMode: 'two' | 'three'
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function outputBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'color-reveal'
}

export async function queueColorRevealBatchExport(options: ColorRevealBatchExportOptions): Promise<number> {
  const stamp = Date.now()
  const entries = await Promise.all(options.sources.map(async ({ asset, pipeline }, index) => {
    const isImage = asset.kind === 'image'
    const resolution = isImage
      ? await loadCreativeImageSize(asset)
      : await window.luna.workspace.getMediaResolution(asset.path)
    const mediaDuration = isImage
      ? IMAGE_CREATIVE_DURATION
      : await window.luna.workspace.getVideoDuration(asset.path)
    const trimStart = isImage ? 0 : pipeline.trim?.startTime ?? 0
    const sourceDuration = isImage
      ? IMAGE_CREATIVE_DURATION
      : Math.max(0, (pipeline.trim?.endTime ?? mediaDuration) - trimStart)
    const creativeDuration = colorRevealCreativeDuration(isImage, sourceDuration, options.initialHoldDuration)
    const transitionMax = colorRevealTransitionMax(
      isImage,
      creativeDuration,
      sourceDuration,
      options.initialHoldDuration,
      options.midpointHoldDuration,
    )
    const metadata = pipeline.border.enabled
      ? await window.luna.getMediaMetadataByPath(asset.path).catch(() => ({ groups: [] }))
      : null
    const allowWatermark = usesCustomWatermark(pipeline.watermark)
      || await canUseLunaUltraWatermark(asset.path, asset.kind)
    const outputSize = outputSizeForTransform(resolution, pipeline.transform)
    const resolved = resolveExportConfig(options.config, outputSize.width, outputSize.height)
    const baseLayers = buildWorkspaceExportLayers(asset.path, resolution, pipeline, metadata, allowWatermark)
    const effectLayers = buildColorRevealLayers({
      sourcePath: asset.path,
      layers: baseLayers,
      isVideo: !isImage,
      trimStart,
      sourceDuration,
      effectStart: options.initialHoldDuration,
      revealStart: options.initialHoldDuration,
      transitionDuration: Math.min(options.transitionDuration, transitionMax),
      midpointHoldDuration: options.midpointHoldDuration,
      saturation: options.saturation,
      gray: options.gray,
      stageMode: options.stageMode,
      forExport: true,
    })
    const itemId = `color_reveal_${stamp}_${index}`
    const fileName = `${outputBaseName(asset.name)}-color-reveal-${stamp}-${index + 1}.mp4`
    return {
      asset,
      itemId,
      path: outputPath(options.exportDir, fileName),
      layers: effectLayers,
      creativeDuration,
      resolved,
    }
  }))

  const task = await window.luna.exportTask.create('色彩还原', entries.map((entry) => ({
    id: entry.itemId,
    sourcePath: entry.asset.path,
    outputPath: entry.path,
    label: '创意视频',
  })))

  void (async () => {
    for (const entry of entries) {
      const currentTask = await window.luna.exportTask.get(task.id).catch(() => null)
      const itemStatus = currentTask?.items.find((item) => item.id === entry.itemId)?.status
      if (itemStatus === 'canceled') continue
      await exportPreviewVideo({
        exportDir: options.exportDir,
        fileName: entry.path.split(/[/\\]/).pop() || `${entry.itemId}.mp4`,
        width: entry.resolved.width,
        height: entry.resolved.height,
        layers: entry.layers,
        qualityPreset: entry.resolved.qualityPreset,
        fps: entry.resolved.fps,
        duration: entry.creativeDuration,
        includeAudio: entry.resolved.includeAudio,
        exportTaskId: task.id,
        exportItemId: entry.itemId,
        taskName: '色彩还原',
      }).catch(() => {
        // 失败状态由导出任务服务记录并展示，继续处理剩余素材。
      })
    }
  })()

  return entries.length
}
