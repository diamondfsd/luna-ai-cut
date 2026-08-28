import {
  emitLocalExportProgress,
  exportPreviewImage,
  exportPreviewVideo,
  resolveExportConfig,
} from '../../components/previewStageExport'
import type { PreviewLayer, VideoExportFormat, VideoExportSettings } from '../../shared/types'
import { logExport } from '../../lib/rendererLogger'

export interface WorkspaceMixedExportPlanItem {
  id: string
  kind: 'video' | 'photo' | 'live'
  sourcePath: string
  outputBaseName: string
  layers: PreviewLayer[]
  outputSize: { width: number; height: number }
  startTime?: number
  endTime?: number
  time?: number
  coverTime?: number
}

interface QueueEntry {
  id: string
  plan: WorkspaceMixedExportPlanItem
  format: 'video' | 'photo' | Exclude<VideoExportFormat, 'video'>
  outputPath: string
  label: string
}

function joinPath(directory: string, fileName: string): string {
  return `${directory.replace(/[\\/]$/, '')}/${fileName}`
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function offsetVideoLayers(layers: PreviewLayer[], startTime: number, duration: number): PreviewLayer[] {
  return layers.map((layer) => layer.isVideo ? {
    ...layer,
    videoTime: (layer.videoTime ?? 0) + startTime,
    videoDuration: duration,
  } : layer)
}

function selectedEntries(
  plan: WorkspaceMixedExportPlanItem[],
  exportDir: string,
  config: VideoExportSettings,
  stamp: number,
): QueueEntry[] {
  const formats = new Set(config.exportFormats)
  return plan.flatMap((item): QueueEntry[] => {
    if (item.kind === 'video') {
      if (!formats.has('video')) return []
      return [{
        id: `mixed_${item.id}_video_${stamp}`,
        plan: item,
        format: 'video',
        outputPath: joinPath(exportDir, `${item.outputBaseName}_${stamp}.mp4`),
        label: '普通视频',
      }]
    }
    if (item.kind === 'photo') {
      if (!config.exportPhotos) return []
      return [{
        id: `mixed_${item.id}_photo_${stamp}`,
        plan: item,
        format: 'photo',
        outputPath: joinPath(exportDir, `${item.outputBaseName}_${stamp}.jpg`),
        label: '照片',
      }]
    }
    return [...formats]
      .filter((format): format is Exclude<VideoExportFormat, 'video'> => format !== 'video')
      .map((format) => ({
        id: `mixed_${item.id}_${format}_${stamp}`,
        plan: item,
        format,
        outputPath: joinPath(exportDir, `${item.outputBaseName}_${format === 'apple-live' ? 'apple_live' : 'google_live'}_${stamp}.jpg`),
        label: format === 'apple-live' ? 'Apple Live 图' : '通用 Live 图',
      }))
  })
}

export function summarizeWorkspaceMixedExport(plan: WorkspaceMixedExportPlanItem[]): {
  video: number
  photo: number
  live: number
  text: string
} {
  const counts = plan.reduce((result, item) => ({ ...result, [item.kind]: result[item.kind] + 1 }), {
    video: 0,
    photo: 0,
    live: 0,
  })
  const parts = [
    counts.video > 0 ? `${counts.video} 个视频` : '',
    counts.photo > 0 ? `${counts.photo} 张照片` : '',
    counts.live > 0 ? `${counts.live} 个 Live 图片段` : '',
  ].filter(Boolean)
  return { ...counts, text: parts.join('、') }
}

export async function queueWorkspaceMixedExport(
  plan: WorkspaceMixedExportPlanItem[],
  exportDir: string,
  config: VideoExportSettings,
): Promise<{ taskId: string; itemCount: number }> {
  const stamp = Date.now()
  const entries = selectedEntries(plan, exportDir, config, stamp)
  if (entries.length === 0) throw new Error('请至少选择一种导出内容')
  if (entries.some((entry) => entry.format === 'apple-live') && !window.navigator.platform.includes('Mac')) {
    throw new Error('Apple Live 图仅支持在 Mac 上导出')
  }

  const taskName = '工作台混合导出'
  const task = await window.luna.exportTask.create(taskName, entries.map((entry) => ({
    id: entry.id,
    sourcePath: entry.plan.sourcePath,
    outputPath: entry.outputPath,
    label: entry.label,
    ...(entry.format === 'apple-live' ? { openTarget: 'photos' as const, previewable: false } : {}),
  })))

  const report = async (
    entry: QueueEntry,
    index: number,
    percent: number,
    status: 'queued' | 'exporting' | 'done' | 'failed' | 'canceled',
    destinationPath = entry.outputPath,
    error?: string,
  ): Promise<void> => {
    await window.luna.exportTask.updateItem(task.id, entry.id, {
      progress: percent,
      status,
      destinationPath,
      error,
    }).catch(() => {})
    emitLocalExportProgress({
      exportId: entry.id,
      taskId: task.id,
      taskName,
      fileName: fileName(destinationPath),
      index,
      totalFiles: entries.length,
      percent,
      status,
      destinationPath,
      error,
    })
  }

  await Promise.all(entries.map((entry, index) => report(entry, index, 0, 'queued')))

  window.setTimeout(() => {
    void (async () => {
      const handledLiveIds = new Set<string>()
      for (const [index, entry] of entries.entries()) {
        const currentTask = await window.luna.exportTask.get(task.id)
        const currentStatus = currentTask?.items.find((item) => item.id === entry.id)?.status
        if (currentStatus === 'canceled') {
          await report(entry, index, 0, 'canceled')
          continue
        }

        if (entry.plan.kind === 'live') {
          if (handledLiveIds.has(entry.plan.id)) continue
          handledLiveIds.add(entry.plan.id)
          const liveCandidates = entries.filter((candidate) => candidate.plan.id === entry.plan.id && candidate.plan.kind === 'live')
          const liveTask = await window.luna.exportTask.get(task.id)
          const liveEntries = liveCandidates.filter((candidate) => (
            liveTask?.items.find((item) => item.id === candidate.id)?.status !== 'canceled'
          ))
          if (liveEntries.length === 0) continue
          const startTime = entry.plan.startTime
          const endTime = entry.plan.endTime
          const coverTime = entry.plan.coverTime
          if (startTime === undefined || endTime === undefined || coverTime === undefined) {
            await Promise.all(liveEntries.map((candidate) => report(candidate, entries.indexOf(candidate), 100, 'failed', candidate.outputPath, 'Live 图片段时间无效')))
            continue
          }
          const duration = endTime - startTime
          const resolved = resolveExportConfig(config, entry.plan.outputSize.width, entry.plan.outputSize.height)
          const tempPrefix = `.${entry.plan.outputBaseName}_${stamp}`
          const tempVideoName = `${tempPrefix}.mp4`
          const tempImageName = `${tempPrefix}.jpg`
          const tempVideoPath = joinPath(exportDir, tempVideoName)
          const tempImagePath = joinPath(exportDir, tempImageName)
          try {
            await Promise.all(liveEntries.map((candidate) => report(candidate, entries.indexOf(candidate), 1, 'exporting')))
            const renderTaskId = `mixed_live_${entry.plan.id}_${stamp}`
            await exportPreviewVideo({
              exportDir,
              fileName: tempVideoName,
              width: resolved.width,
              height: resolved.height,
              layers: offsetVideoLayers(entry.plan.layers, startTime, duration),
              fps: resolved.fps,
              qualityPreset: resolved.qualityPreset ?? 'high',
              includeAudio: resolved.includeAudio,
              renderTaskId,
              onProgress: async (progress) => {
                const latestTask = await window.luna.exportTask.get(task.id)
                const allCanceled = liveEntries.every((candidate) => (
                  latestTask?.items.find((item) => item.id === candidate.id)?.status === 'canceled'
                ))
                if (allCanceled) {
                  await window.luna.cancelExportTask(renderTaskId).catch(() => {})
                  return
                }
                const percent = Math.min(85, Math.max(1, Math.round(progress * 0.85)))
                await Promise.all(liveEntries.map((candidate) => report(candidate, entries.indexOf(candidate), percent, 'exporting')))
              },
            })
            await exportPreviewImage({
              exportDir,
              fileName: tempImageName,
              width: resolved.width,
              height: resolved.height,
              layers: offsetVideoLayers(entry.plan.layers, coverTime, 0.1),
              format: 'jpeg',
              quality: 100,
            })
            for (const liveEntry of liveEntries) {
              try {
                await report(liveEntry, entries.indexOf(liveEntry), 92, 'exporting')
                const result = await window.luna.workspace.exportRenderedLivePhoto(
                  `${liveEntry.plan.outputBaseName}_${liveEntry.format === 'apple-live' ? 'apple_live' : 'google_live'}`,
                  tempImagePath,
                  tempVideoPath,
                  liveEntry.format === 'apple-live',
                  true,
                  false,
                  coverTime - startTime,
                )
                await report(liveEntry, entries.indexOf(liveEntry), 100, 'done', result.path)
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                await report(liveEntry, entries.indexOf(liveEntry), 100, 'failed', liveEntry.outputPath, message)
              }
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await Promise.all(liveEntries.map((candidate) => report(candidate, entries.indexOf(candidate), 100, 'failed', candidate.outputPath, message)))
          } finally {
            await window.luna.deleteLocalFiles([tempVideoPath, tempImagePath]).catch(() => {})
          }
          continue
        }

        try {
          await report(entry, index, 0, 'exporting')
          const resolved = resolveExportConfig(config, entry.plan.outputSize.width, entry.plan.outputSize.height)
          logExport('[导出诊断] 工作台导出尺寸解析', {
            sourcePath: entry.plan.sourcePath,
            planOutputSize: entry.plan.outputSize,
            resolutionSetting: config.resolution,
            resolvedSize: { width: resolved.width, height: resolved.height },
          })
          if (entry.plan.kind === 'video') {
            const startTime = entry.plan.startTime ?? 0
            const endTime = entry.plan.endTime ?? startTime + 0.1
            await exportPreviewVideo({
              exportDir,
              fileName: fileName(entry.outputPath),
              width: resolved.width,
              height: resolved.height,
              layers: offsetVideoLayers(entry.plan.layers, startTime, endTime - startTime),
              fps: resolved.fps,
              qualityPreset: resolved.qualityPreset ?? 'high',
              includeAudio: resolved.includeAudio,
              exportTaskId: task.id,
              exportItemId: entry.id,
              taskName,
              index,
              totalFiles: entries.length,
              onProgress: async () => {
                const latestTask = await window.luna.exportTask.get(task.id)
                if (latestTask?.items.find((item) => item.id === entry.id)?.status === 'canceled') {
                  await window.luna.cancelExportTask(entry.id).catch(() => {})
                }
              },
            })
          } else {
            const layers = entry.plan.time === undefined
              ? entry.plan.layers
              : offsetVideoLayers(entry.plan.layers, entry.plan.time, 0.1)
            const result = await exportPreviewImage({
              exportDir,
              fileName: fileName(entry.outputPath),
              width: resolved.width,
              height: resolved.height,
              layers,
              format: 'jpeg',
              quality: 100,
              exportTaskId: task.id,
              exportItemId: entry.id,
            })
            await report(entry, index, 100, 'done', result.path)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await report(entry, index, 100, message === '导出已取消' ? 'canceled' : 'failed', entry.outputPath, message)
        }
      }
    })().catch((error) => console.error('[WorkspaceMixedExport] queue failed', error))
  }, 0)

  return { taskId: task.id, itemCount: entries.length }
}
