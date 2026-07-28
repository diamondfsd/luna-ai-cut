import { emitLocalExportProgress, resolveExportConfig } from '../../../components/previewStageExport'
import { buildCompositionFromPreviewLayers } from '../../../components/renderComposition'
import { DEFAULT_VIDEO_EXPORT_SETTINGS, type CompositionInput, type PreviewLayer, type VideoExportSettings, type WorkspaceMediaAsset } from '../../../shared/types'

export const PIXEL_FLOW_LIVE_DURATION = 3
export const PIXEL_FLOW_IMAGE_EXPORT_SETTINGS: VideoExportSettings = {
  ...DEFAULT_VIDEO_EXPORT_SETTINGS,
  exportFormats: ['google-live'],
  trimStartTime: 0,
  trimEndTime: PIXEL_FLOW_LIVE_DURATION,
  liveStartTime: 0,
  liveCoverTime: PIXEL_FLOW_LIVE_DURATION - 1 / 30,
}

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

interface PixelFlowExportOptions {
  asset: WorkspaceMediaAsset
  layers: PreviewLayer[]
  sourceSize: { width: number; height: number }
  config: VideoExportSettings
}

interface LiveExportEntry {
  id: string
  format: 'google-live' | 'apple-live'
  outputPath: string
}

function renderApi(): LunaCompositionExportApi {
  const api = (window as unknown as { lunaRenderCore?: LunaCompositionExportApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

function filePath(exportDir: string, name: string): string {
  return `${exportDir.replace(/[\\/]$/, '')}/${name}`
}

function outputBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'pixel-flow'
}

function reportLiveEntry(
  taskId: string,
  taskName: string,
  entry: LiveExportEntry,
  index: number,
  total: number,
  percent: number,
  status: 'exporting' | 'done' | 'failed',
  destinationPath?: string,
  error?: string,
): Promise<void> {
  emitLocalExportProgress({
    exportId: entry.id,
    taskId,
    taskName,
    fileName: entry.outputPath.split(/[/\\]/).pop() || 'Live 图',
    index,
    totalFiles: total,
    percent,
    status,
    destinationPath: destinationPath ?? entry.outputPath,
    error,
  })
  return window.luna.exportTask.updateItem(taskId, entry.id, {
    status,
    progress: percent,
    destinationPath,
    error,
  }).catch(() => undefined)
}

async function runImageLiveExport(options: PixelFlowExportOptions, exportDir: string): Promise<number> {
  const formats = [...new Set(options.config.exportFormats.filter(
    (format): format is LiveExportEntry['format'] => format === 'google-live' || format === 'apple-live',
  ))]
  if (formats.length === 0) throw new Error('请至少选择一种 Live 图格式')

  const stamp = Date.now()
  const baseName = outputBaseName(options.asset.name)
  const resolved = resolveExportConfig(options.config, options.sourceSize.width, options.sourceSize.height)
  const entries: LiveExportEntry[] = formats.map((format, index) => ({
    id: `pixel_flow_${format}_${stamp}_${index}`,
    format,
    outputPath: filePath(exportDir, `${baseName}-pixel-flow-${format}-${stamp}.jpg`),
  }))
  const taskName = '像素流光 Live 图'
  const task = await window.luna.exportTask.create(taskName, entries.map((entry) => ({
    id: entry.id,
    sourcePath: options.asset.path,
    outputPath: entry.outputPath,
    label: entry.format === 'apple-live' ? 'Apple Live 图' : '通用 Live 图',
  })))

  void (async () => {
    const tempVideoPath = filePath(exportDir, `.${baseName}-pixel-flow-${stamp}.mp4`)
    const tempImagePath = filePath(exportDir, `.${baseName}-pixel-flow-${stamp}.jpg`)
    const composition = buildCompositionFromPreviewLayers(options.layers, resolved.width, resolved.height, {
      fps: resolved.fps ?? undefined,
      duration: PIXEL_FLOW_LIVE_DURATION,
    })
    composition.canvas.duration = PIXEL_FLOW_LIVE_DURATION
    try {
      await Promise.all(entries.map((entry, index) => reportLiveEntry(task.id, taskName, entry, index, entries.length, 5, 'exporting')))
      await renderApi().exportCompositionVideo(
        tempVideoPath,
        composition,
        resolved.fps,
        PIXEL_FLOW_LIVE_DURATION,
        true,
        `pixel_flow_live_render_${stamp}`,
        resolved.qualityPreset ?? 'high',
      )
      await Promise.all(entries.map((entry, index) => reportLiveEntry(task.id, taskName, entry, index, entries.length, 75, 'exporting')))

      const coverTime = PIXEL_FLOW_LIVE_DURATION - 1 / 30
      await window.luna.workspace.extractVideoFrame(tempVideoPath, tempImagePath, coverTime)
      for (const [index, entry] of entries.entries()) {
        const currentTask = await window.luna.exportTask.get(task.id).catch(() => undefined)
        if (currentTask?.items.find((item) => item.id === entry.id)?.status === 'canceled') continue
        try {
          await reportLiveEntry(task.id, taskName, entry, index, entries.length, 90, 'exporting')
          const result = await window.luna.workspace.exportRenderedLivePhoto(
            `${baseName}-pixel-flow-${entry.format}`,
            tempImagePath,
            tempVideoPath,
            entry.format === 'apple-live',
            true,
            false,
            coverTime,
          )
          await reportLiveEntry(task.id, taskName, entry, index, entries.length, 100, 'done', result.path)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Live 图导出失败'
          await reportLiveEntry(task.id, taskName, entry, index, entries.length, 100, 'failed', undefined, message)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live 图导出失败'
      await Promise.all(entries.map(async (entry, index) => {
        const currentTask = await window.luna.exportTask.get(task.id).catch(() => undefined)
        const status = currentTask?.items.find((item) => item.id === entry.id)?.status
        if (status !== 'done' && status !== 'canceled') {
          await reportLiveEntry(task.id, taskName, entry, index, entries.length, 100, 'failed', undefined, message)
        }
      }))
    } finally {
      await window.luna.deleteLocalFiles([tempVideoPath, tempImagePath]).catch(() => undefined)
    }
  })()

  return entries.length
}

async function runVideoExport(options: PixelFlowExportOptions, exportDir: string): Promise<number> {
  const stamp = Date.now()
  const baseName = outputBaseName(options.asset.name)
  const fileName = `${baseName}-pixel-flow-${stamp}.mp4`
  const destinationPath = filePath(exportDir, fileName)
  const itemId = `pixel_flow_video_${stamp}`
  const sourceDuration = await window.luna.workspace.getVideoDuration(options.asset.path)
  const resolved = resolveExportConfig(options.config, options.sourceSize.width, options.sourceSize.height)
  const layers = options.layers.map((layer) => layer.isVideo ? { ...layer, videoDuration: sourceDuration } : layer)
  const composition = buildCompositionFromPreviewLayers(layers, resolved.width, resolved.height, {
    fps: resolved.fps ?? undefined,
    duration: sourceDuration,
  })
  composition.canvas.duration = sourceDuration
  const task = await window.luna.exportTask.create('像素流光视频', [{
    id: itemId,
    sourcePath: options.asset.path,
    outputPath: destinationPath,
    label: '创意视频',
  }])

  void renderApi().exportCompositionVideo(
    destinationPath,
    composition,
    resolved.fps,
    sourceDuration,
    true,
    itemId,
    resolved.qualityPreset,
    task.id,
    itemId,
  ).catch(async (error) => {
    const message = error instanceof Error ? error.message : '视频导出失败'
    await window.luna.exportTask.updateItem(task.id, itemId, { status: 'failed', error: message }).catch(() => undefined)
  })
  return 1
}

export async function queuePixelFlowExport(options: PixelFlowExportOptions): Promise<number> {
  const settings = await window.luna.getSettings()
  if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
  if (options.asset.kind === 'image') return runImageLiveExport(options, settings.exportDir)
  return runVideoExport(options, settings.exportDir)
}
