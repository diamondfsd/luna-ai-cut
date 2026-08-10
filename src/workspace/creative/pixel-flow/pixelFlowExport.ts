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
    includeAudio?: boolean,
  ): Promise<void>
}

interface PixelFlowExportOptions {
  asset: WorkspaceMediaAsset
  layers: PreviewLayer[]
  sourceSize: { width: number; height: number }
  playbackDuration: number
  config: VideoExportSettings
}

interface LiveExportEntry {
  id: string
  format: 'google-live' | 'apple-live'
  outputPath: string
}

interface VideoExportEntry {
  id: string
  outputPath: string
}

interface PixelFlowExportPlan {
  video?: VideoExportEntry
  live: LiveExportEntry[]
}

interface PixelFlowExportTask {
  id: string
  name: string
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

function buildExportPlan(
  options: PixelFlowExportOptions,
  exportDir: string,
  stamp: number,
  index: number,
  total: number,
): PixelFlowExportPlan {
  const baseName = outputBaseName(options.asset.name)
  const suffix = total > 1 ? `-${index + 1}` : ''
  const liveFormats = options.asset.kind === 'image'
    ? [...new Set(options.config.exportFormats.filter(
        (format): format is LiveExportEntry['format'] => format === 'google-live' || format === 'apple-live',
      ))]
    : []
  return {
    video: options.config.exportFormats.includes('video') ? {
      id: `pixel_flow_video_${stamp}_${index}`,
      outputPath: filePath(exportDir, `${baseName}-pixel-flow-${stamp}${suffix}.mp4`),
    } : undefined,
    live: liveFormats.map((format) => ({
      id: `pixel_flow_${format}_${stamp}_${index}`,
      format,
      outputPath: filePath(exportDir, `${baseName}-pixel-flow-${format}-${stamp}${suffix}.jpg`),
    })),
  }
}

function planItems(options: PixelFlowExportOptions, plan: PixelFlowExportPlan) {
  return [
    ...(plan.video ? [{
      id: plan.video.id,
      sourcePath: options.asset.path,
      outputPath: plan.video.outputPath,
      label: '创意视频',
    }] : []),
    ...plan.live.map((entry) => ({
      id: entry.id,
      sourcePath: options.asset.path,
      outputPath: entry.outputPath,
      label: entry.format === 'apple-live' ? 'Apple Live 图' : '通用 Live 图',
    })),
  ]
}

function reportLiveEntry(
  task: PixelFlowExportTask,
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
    taskId: task.id,
    taskName: task.name,
    fileName: entry.outputPath.split(/[/\\]/).pop() || 'Live 图',
    index,
    totalFiles: total,
    percent,
    status,
    destinationPath: destinationPath ?? entry.outputPath,
    error,
  })
  return window.luna.exportTask.updateItem(task.id, entry.id, {
    status,
    progress: percent,
    destinationPath,
    error,
  }).catch(() => undefined)
}

async function itemCanceled(taskId: string, itemId: string): Promise<boolean> {
  const task = await window.luna.exportTask.get(taskId).catch(() => undefined)
  return task?.items.find((item) => item.id === itemId)?.status === 'canceled'
}

async function allItemsCanceled(taskId: string, itemIds: string[]): Promise<boolean> {
  const task = await window.luna.exportTask.get(taskId).catch(() => undefined)
  return itemIds.every((itemId) => task?.items.find((item) => item.id === itemId)?.status === 'canceled')
}

async function runImageLiveExport(
  options: PixelFlowExportOptions,
  exportDir: string,
  task: PixelFlowExportTask,
  plan: PixelFlowExportPlan,
): Promise<void> {
  const entries = plan.live
  if (entries.length === 0 || await allItemsCanceled(task.id, entries.map((entry) => entry.id))) return

  const baseName = outputBaseName(options.asset.name)
  const tempSuffix = entries[0].id.replace(/[^a-zA-Z0-9_-]/g, '_')
  const tempVideoPath = filePath(exportDir, `.${baseName}-${tempSuffix}.mp4`)
  const tempImagePath = filePath(exportDir, `.${baseName}-${tempSuffix}.jpg`)
  const resolved = resolveExportConfig(options.config, options.sourceSize.width, options.sourceSize.height)
  const composition = buildCompositionFromPreviewLayers(options.layers, resolved.width, resolved.height, {
    fps: resolved.fps ?? undefined,
    duration: PIXEL_FLOW_LIVE_DURATION,
  })
  composition.canvas.duration = PIXEL_FLOW_LIVE_DURATION
  try {
    await Promise.all(entries.map((entry, index) => reportLiveEntry(task, entry, index, entries.length, 5, 'exporting')))
    await renderApi().exportCompositionVideo(
      tempVideoPath,
      composition,
      resolved.fps,
      PIXEL_FLOW_LIVE_DURATION,
      true,
      `pixel_flow_live_render_${tempSuffix}`,
      resolved.qualityPreset ?? 'high',
      undefined,
      undefined,
      resolved.includeAudio,
    )
    await Promise.all(entries.map((entry, index) => reportLiveEntry(task, entry, index, entries.length, 75, 'exporting')))

    const coverTime = PIXEL_FLOW_LIVE_DURATION - 1 / 30
    await window.luna.workspace.extractVideoFrame(tempVideoPath, tempImagePath, coverTime)
    for (const [index, entry] of entries.entries()) {
      if (await itemCanceled(task.id, entry.id)) continue
      try {
        await reportLiveEntry(task, entry, index, entries.length, 90, 'exporting')
        const result = await window.luna.workspace.exportRenderedLivePhoto(
          `${baseName}-pixel-flow-${entry.format}`,
          tempImagePath,
          tempVideoPath,
          entry.format === 'apple-live',
          true,
          false,
          coverTime,
        )
        await reportLiveEntry(task, entry, index, entries.length, 100, 'done', result.path)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Live 图导出失败'
        await reportLiveEntry(task, entry, index, entries.length, 100, 'failed', undefined, message)
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live 图导出失败'
    await Promise.all(entries.map(async (entry, index) => {
      if (!await itemCanceled(task.id, entry.id)) {
        await reportLiveEntry(task, entry, index, entries.length, 100, 'failed', undefined, message)
      }
    }))
  } finally {
    await window.luna.deleteLocalFiles([tempVideoPath, tempImagePath]).catch(() => undefined)
  }
}

async function runVideoExport(
  options: PixelFlowExportOptions,
  task: PixelFlowExportTask,
  entry?: VideoExportEntry,
): Promise<void> {
  if (!entry || await itemCanceled(task.id, entry.id)) return
  const sourceDuration = options.playbackDuration
  const resolved = resolveExportConfig(options.config, options.sourceSize.width, options.sourceSize.height)
  const layers = options.layers.map((layer) => layer.isVideo ? { ...layer, videoDuration: sourceDuration } : layer)
  const composition = buildCompositionFromPreviewLayers(layers, resolved.width, resolved.height, {
    fps: resolved.fps ?? undefined,
    duration: sourceDuration,
  })
  composition.canvas.duration = sourceDuration
  await renderApi().exportCompositionVideo(
    entry.outputPath,
    composition,
    resolved.fps,
    sourceDuration,
    true,
    entry.id,
    resolved.qualityPreset,
    task.id,
    entry.id,
    resolved.includeAudio,
  ).catch(async (error) => {
    const message = error instanceof Error ? error.message : '视频导出失败'
    await window.luna.exportTask.updateItem(task.id, entry.id, { status: 'failed', error: message }).catch(() => undefined)
  })
}

export async function queuePixelFlowExports(exports: PixelFlowExportOptions[]): Promise<number> {
  if (exports.length === 0) return 0
  const settings = await window.luna.getSettings()
  if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
  const exportDir = settings.exportDir
  const stamp = Date.now()
  const plans = exports.map((options, index) => buildExportPlan(options, exportDir, stamp, index, exports.length))
  const items = exports.flatMap((options, index) => planItems(options, plans[index]))
  if (items.length === 0) throw new Error('请至少选择一种导出格式')
  const task = await window.luna.exportTask.create('像素流光', items)

  void (async () => {
    for (const [index, options] of exports.entries()) {
      const plan = plans[index]
      try {
        await runVideoExport(options, task, plan.video)
      } catch (error) {
        if (plan.video && !await itemCanceled(task.id, plan.video.id)) {
          const message = error instanceof Error ? error.message : '视频导出失败'
          await window.luna.exportTask.updateItem(task.id, plan.video.id, {
            status: 'failed',
            error: message,
          }).catch(() => undefined)
        }
      }
      try {
        await runImageLiveExport(options, exportDir, task, plan)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Live 图导出失败'
        await Promise.all(plan.live.map(async (entry) => {
          if (!await itemCanceled(task.id, entry.id)) {
            await window.luna.exportTask.updateItem(task.id, entry.id, {
              status: 'failed',
              error: message,
            }).catch(() => undefined)
          }
        }))
      }
    }
  })()
  return items.length
}

export function queuePixelFlowExport(options: PixelFlowExportOptions): Promise<number> {
  return queuePixelFlowExports([options])
}
