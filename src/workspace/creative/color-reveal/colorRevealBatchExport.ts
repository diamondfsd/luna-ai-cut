import { resolveExportConfig } from '../../../components/previewStageExport'
import { buildCompositionFromPreviewLayers } from '../../../components/renderComposition'
import type { CompositionInput, VideoExportSettings, WorkspaceMediaAsset } from '../../../shared/types'
import type { EditPipeline } from '../../shared/editPipeline'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { colorRevealCreativeDuration, colorRevealTransitionMax, IMAGE_CREATIVE_DURATION } from './colorRevealConfig'
import { buildColorRevealLayers } from './colorRevealLayers'

interface LunaCompositionExportApi {
  exportCompositionVideo(
    outputPath: string,
    composition: CompositionInput,
    fps: number | null,
    duration: number | null,
    hardware: boolean,
    taskId?: string,
    qualityPreset?: string,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
}

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

function renderApi(): LunaCompositionExportApi {
  const api = (window as unknown as { lunaRenderCore?: LunaCompositionExportApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function outputBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'color-reveal'
}

export async function queueColorRevealBatchExport(options: ColorRevealBatchExportOptions): Promise<number> {
  const api = renderApi()
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
    const outputSize = outputSizeForTransform(resolution, pipeline.transform)
    const resolved = resolveExportConfig(options.config, outputSize.width, outputSize.height)
    const baseLayers = buildWorkspaceExportLayers(asset.path, resolution, pipeline, metadata)
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
    const composition = buildCompositionFromPreviewLayers(effectLayers, resolved.width, resolved.height, {
      fps: resolved.fps ?? undefined,
      duration: creativeDuration,
    })
    composition.canvas.duration = creativeDuration
    const itemId = `color_reveal_${stamp}_${index}`
    const fileName = `${outputBaseName(asset.name)}-color-reveal-${stamp}-${index + 1}.mp4`
    return {
      asset,
      itemId,
      path: outputPath(options.exportDir, fileName),
      composition,
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
      await api.exportCompositionVideo(
        entry.path,
        entry.composition,
        entry.resolved.fps,
        entry.creativeDuration,
        true,
        entry.itemId,
        entry.resolved.qualityPreset,
        task.id,
        entry.itemId,
      ).catch(() => {
        // 失败状态由导出任务服务记录并展示，继续处理剩余素材。
      })
    }
  })()

  return entries.length
}
