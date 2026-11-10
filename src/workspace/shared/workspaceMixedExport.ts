import {
  emitLocalExportProgress,
  exportPreviewImage,
  exportPreviewVideo,
  resolveExportConfig,
} from '../../components/previewStageExport'
import type { PreviewLayer, VideoExportFormat, VideoExportSettings } from '../../shared/types'
import type { ExportTaskPayload, WorkspaceExportTaskPayload } from '../../shared/types'
import { logExport } from '../../lib/rendererLogger'
import { createDirectoryExportNameAllocator } from '../../lib/exportNameAllocator'
import { resolveWorkspaceVideoExportRange } from './workspaceExportRange'
import { resolveLivePhotoCoverTime } from './livePhotoFrameTime'
import { exportWorkspaceLivePhotoSource, replaceLivePhotoSourceWithVideo } from './workspaceSourceLivePhotoExport'
import { failUnfinishedExportItems } from '../../lib/exportTaskRecovery'

export type WorkspaceMixedExportPlanItem = WorkspaceExportTaskPayload['entries'][number]['plan']

type QueueEntry = WorkspaceExportTaskPayload['entries'][number]

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
  allocateName: (desiredName: string) => string,
): QueueEntry[] {
  const formats = new Set(config.exportFormats)
  return plan.flatMap((item): QueueEntry[] => {
    if (item.kind === 'video') {
      if (!formats.has('video')) return []
      return [{
        id: `mixed_${item.id}_video_${stamp}`,
        plan: item,
        format: 'video',
        outputPath: joinPath(exportDir, allocateName(`${item.outputBaseName}.mp4`)),
        label: '普通视频',
      }]
    }
    if (item.kind === 'photo') {
      const photoEntries: QueueEntry[] = []
      if (config.exportPhotos) {
        photoEntries.push({
          id: `mixed_${item.id}_photo_${stamp}`,
          plan: item,
          format: 'photo',
          outputPath: joinPath(exportDir, allocateName(`${item.outputBaseName}.jpg`)),
          label: '照片',
        })
      }
      if (config.exportLiveVideo && item.isLivePhoto) {
        photoEntries.push({
          id: `mixed_${item.id}_live_video_${stamp}`,
          plan: item,
          format: 'live-video',
          outputPath: joinPath(exportDir, allocateName(`${item.outputBaseName}_live.mp4`)),
          label: 'Live 图视频',
        })
      }
      return photoEntries
    }
    const liveEntries: QueueEntry[] = [...formats]
      .filter((format): format is Exclude<VideoExportFormat, 'video'> => format !== 'video')
      .map((format) => ({
        id: `mixed_${item.id}_${format}_${stamp}`,
        plan: item,
        format,
        outputPath: joinPath(exportDir, allocateName(`${item.outputBaseName}_${format === 'apple-live' ? 'apple_live' : 'google_live'}.jpg`)),
        label: format === 'apple-live' ? 'Apple Live 图' : '通用 Live 图',
      }))
    return liveEntries
  })
}

export function summarizeWorkspaceMixedExport(plan: WorkspaceMixedExportPlanItem[]): {
  video: number
  photo: number
  live: number
  livePhotos: number
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
  const livePhotos = plan.filter((item) => item.kind === 'photo' && item.isLivePhoto).length
  return { ...counts, livePhotos, text: parts.join('、') }
}

export async function queueWorkspaceMixedExport(
  plan: WorkspaceMixedExportPlanItem[],
  exportDir: string,
  config: VideoExportSettings,
): Promise<{ taskId: string; itemCount: number }> {
  const stamp = Date.now()
  const allocateName = await createDirectoryExportNameAllocator(exportDir)
  const entries = selectedEntries(plan, exportDir, config, stamp, allocateName)
  const videoPlans = plan.filter((item) => item.kind === 'video')
  const adjustableVideoId = videoPlans.length === 1 ? videoPlans[0].id : null
  if (entries.length === 0) throw new Error('请至少选择一种导出内容')
  if (entries.some((entry) => entry.format === 'apple-live') && !window.navigator.platform.includes('Mac')) {
    throw new Error('Apple Live 图仅支持在 Mac 上导出')
  }

  const taskName = '工作台混合导出'
  const payload: WorkspaceExportTaskPayload = {
    version: 1,
    kind: 'workspace',
    exportDir,
    taskName,
    stamp,
    entries,
    config: { ...config, exportFormats: [...config.exportFormats] },
    adjustableVideoId,
  }
  const task = await window.luna.exportTask.create(taskName, entries.map((entry) => ({
    id: entry.id,
    sourcePath: entry.format === 'live-video'
      ? entry.plan.livePhotoSourcePath ?? entry.plan.sourcePath
      : entry.plan.sourcePath,
    outputPath: entry.outputPath,
    label: entry.label,
    ...(entry.format === 'apple-live' ? { openTarget: 'photos' as const, previewable: false } : {}),
  })), undefined, payload)

  void runWorkspaceMixedExportTask(task.id, payload).catch((error) => failUnfinishedExportItems(task.id, error))
  return { taskId: task.id, itemCount: entries.length }
}

export async function resumeWorkspaceMixedExportTask(taskId: string, payload: ExportTaskPayload): Promise<void> {
  if (payload.kind !== 'workspace') throw new Error('导出任务类型不匹配')
  await runWorkspaceMixedExportTask(taskId, payload)
}

async function runWorkspaceMixedExportTask(taskId: string, payload: WorkspaceExportTaskPayload): Promise<void> {
  const task = { id: taskId }
  const { taskName, exportDir, entries, config, stamp, adjustableVideoId } = payload

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

  const queuedItems = await Promise.all(entries.map(async (entry, index) => {
    const taskRecord = await window.luna.exportTask.get(task.id)
    const status = taskRecord?.items.find((item) => item.id === entry.id)?.status
    return status === 'queued' ? report(entry, index, 0, 'queued') : Promise.resolve()
  }))
  await Promise.all(queuedItems)

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
        if (currentStatus === 'done') continue

        if (entry.format === 'live-video') {
          try {
            await report(entry, index, 1, 'exporting')
            const video = await window.luna.previewLivePhoto(entry.plan.livePhotoSourcePath ?? entry.plan.sourcePath)
            if (video.kind !== 'video' || !video.cachedPath) {
              throw new Error(video.message || '没有在 Live 图中找到视频片段')
            }
            const extractedVideoPath = video.cachedPath
            const duration = await window.luna.workspace.getVideoDuration(extractedVideoPath)
            if (!Number.isFinite(duration) || duration <= 0) throw new Error('无法读取 Live 图视频时长')
            const layers = replaceLivePhotoSourceWithVideo(
              entry.plan.layers,
              entry.plan.sourcePath,
              extractedVideoPath,
              duration,
              `live-photo-${entry.id}`,
            )
            if (!layers.some((layer) => layer.isVideo && layer.filePath === extractedVideoPath)) {
              throw new Error('无法处理 Live 图视频')
            }
            const resolved = resolveExportConfig(config, entry.plan.outputSize.width, entry.plan.outputSize.height)
            await exportPreviewVideo({
              exportDir,
              fileName: fileName(entry.outputPath),
              width: resolved.width,
              height: resolved.height,
              layers,
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
            await report(entry, index, 100, 'done', entry.outputPath)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const latestTask = await window.luna.exportTask.get(task.id)
            const canceled = message === '导出已取消'
              || latestTask?.items.find((item) => item.id === entry.id)?.status === 'canceled'
            await report(
              entry,
              index,
              100,
              canceled ? 'canceled' : 'failed',
              entry.outputPath,
              canceled ? undefined : message,
            )
          }
          continue
        }

        if (entry.plan.kind === 'live') {
          if (handledLiveIds.has(entry.plan.id)) continue
          handledLiveIds.add(entry.plan.id)
          const liveCandidates = entries.filter((candidate) => candidate.plan.id === entry.plan.id && candidate.plan.kind === 'live')
          const liveTask = await window.luna.exportTask.get(task.id)
          const liveEntries = liveCandidates.filter((candidate) => (
            !['canceled', 'done'].includes(liveTask?.items.find((item) => item.id === candidate.id)?.status ?? '')
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
          const safeCoverTime = resolveLivePhotoCoverTime(startTime, duration, coverTime, resolved.fps)
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
              layers: offsetVideoLayers(entry.plan.layers, safeCoverTime, 0.1),
              format: 'jpeg',
              quality: 100,
            })
            for (const liveEntry of liveEntries) {
              try {
                await report(liveEntry, entries.indexOf(liveEntry), 92, 'exporting')
                const result = await window.luna.workspace.exportRenderedLivePhoto(
                  fileName(liveEntry.outputPath).replace(/\.[^.]+$/, ''),
                  tempImagePath,
                  tempVideoPath,
                  liveEntry.format === 'apple-live',
                  true,
                  false,
                  safeCoverTime - startTime,
                  exportDir,
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
            const planStart = entry.plan.startTime ?? 0
            const planEnd = entry.plan.endTime ?? planStart + 0.1
            const { startTime, endTime } = resolveWorkspaceVideoExportRange(
              planStart,
              planEnd,
              config.trimStartTime,
              config.trimEndTime,
              entry.plan.id === adjustableVideoId,
            )
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
            if (entry.plan.isLivePhoto && entry.plan.livePhotoSourcePath) {
              const result = await exportWorkspaceLivePhotoSource({
                sourcePath: entry.plan.sourcePath,
                livePhotoSourcePath: entry.plan.livePhotoSourcePath,
                layers,
                outputSize: entry.plan.outputSize,
                exportDir,
                outputFileName: fileName(entry.outputPath),
                stamp,
                config,
                onVideoProgress: async (progress, renderTaskId) => {
                  const latestTask = await window.luna.exportTask.get(task.id)
                  if (latestTask?.items.find((item) => item.id === entry.id)?.status === 'canceled') {
                    await window.luna.cancelExportTask(renderTaskId).catch(() => {})
                    return
                  }
                  await report(entry, index, Math.min(90, 25 + Math.round(progress * 0.65)), 'exporting')
                },
              })
              await report(entry, index, 100, 'done', result.path)
              continue
            }
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
          const latestTask = await window.luna.exportTask.get(task.id)
          const canceled = message === '导出已取消'
            || latestTask?.items.find((item) => item.id === entry.id)?.status === 'canceled'
          await report(entry, index, 100, canceled ? 'canceled' : 'failed', entry.outputPath, canceled ? undefined : message)
        }
      }
    })().catch(async (error) => {
      console.error('[WorkspaceMixedExport] queue failed', error)
      await failUnfinishedExportItems(task.id, error)
    })
  }, 0)

}
