import {
  emitLocalExportProgress,
  exportPreviewImage,
  exportPreviewVideo,
  resolveExportConfig,
  type BatchExportSource,
} from '../../components/previewStageExport'
import type { PreviewLayer, VideoExportFormat, VideoExportSettings } from '../../shared/types'

const LIVE_DURATION = 3
const MAX_COVER_TIME = LIVE_DURATION - 0.01

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function filePath(exportDir: string, name: string): string {
  return `${exportDir.replace(/[\\/]$/, '')}/${name}`
}

function baseName(source: BatchExportSource): string {
  return source.outputBaseName
    || source.sourcePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '')
    || 'workspace'
}

function offsetVideoLayers(layers: PreviewLayer[], offset: number, duration: number): PreviewLayer[] {
  return layers.map((layer) => layer.isVideo ? {
    ...layer,
    videoTime: (layer.videoTime ?? 0) + offset,
    videoDuration: duration,
  } : layer)
}

function formatLabel(format: VideoExportFormat): string {
  if (format === 'google-live') return 'Google Live 图'
  if (format === 'apple-live') return 'Apple Live 图'
  return '普通视频'
}

function formatSuffix(format: VideoExportFormat): string {
  if (format === 'google-live') return '_google_live.jpg'
  if (format === 'apple-live') return '_apple_live.jpg'
  return '.mp4'
}

export async function queueWorkspaceFormatsExport(
  source: BatchExportSource,
  exportDir: string,
  config: VideoExportSettings,
): Promise<{ taskId: string }> {
  if (!source.layers?.some((layer) => layer.isVideo)) throw new Error('当前素材不是视频')
  const formats = [...new Set(config.exportFormats)]
  if (formats.length === 0) throw new Error('请至少选择一种导出格式')
  const hasLive = formats.some((format) => format !== 'video')
  if (hasLive && (!source.mediaDuration || source.mediaDuration < LIVE_DURATION)) throw new Error('视频不足 3 秒')
  if (formats.includes('apple-live') && !window.navigator.platform.includes('Mac')) {
    throw new Error('Apple Live 图仅支持在 Mac 上导出')
  }

  const stamp = Date.now()
  const name = baseName(source)
  const taskName = '工作台导出'
  const items = formats.map((format) => ({
    id: `workspace_${format}_${stamp}`,
    format,
    sourcePath: source.sourcePath,
    outputPath: filePath(exportDir, `${name}_${stamp}${formatSuffix(format)}`),
    label: formatLabel(format),
    ...(format === 'apple-live' ? { openTarget: 'photos' as const, previewable: false } : {}),
  }))
  const task = await window.luna.exportTask.create(taskName, items)

  const report = async (
    format: VideoExportFormat,
    percent: number,
    status: 'queued' | 'exporting' | 'done' | 'failed',
    destinationPath?: string,
    error?: string,
  ): Promise<void> => {
    const index = items.findIndex((item) => item.format === format)
    const item = items[index]
    if (!item) return
    const path = destinationPath ?? item.outputPath
    await window.luna.exportTask.updateItem(task.id, item.id, {
      status,
      progress: percent,
      destinationPath: path,
      error,
    }).catch(() => {})
    emitLocalExportProgress({
      exportId: item.id,
      taskId: task.id,
      taskName,
      fileName: path.split(/[/\\]/).pop() || formatLabel(format),
      index,
      totalFiles: items.length,
      percent,
      status,
      destinationPath: path,
      error,
    })
  }

  await Promise.all(formats.map((format) => report(format, 0, 'queued')))

  window.setTimeout(() => {
    void (async () => {
      const outputSize = source.outputSize ?? await window.luna.workspace.getMediaResolution(source.sourcePath)
      const resolved = resolveExportConfig(config, outputSize.width, outputSize.height)

      if (formats.includes('video')) {
        const item = items.find((candidate) => candidate.format === 'video')!
        try {
          await exportPreviewVideo({
            exportDir,
            fileName: item.outputPath.split(/[/\\]/).pop()!,
            width: resolved.width,
            height: resolved.height,
            layers: source.layers!,
            fps: resolved.fps,
            qualityPreset: resolved.qualityPreset,
            exportTaskId: task.id,
            exportItemId: item.id,
            taskName,
            index: items.indexOf(item),
            totalFiles: items.length,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await report('video', 100, 'failed', item.outputPath, message)
        }
      }

      const liveFormats = formats.filter((format) => format !== 'video')
      if (liveFormats.length === 0) return
      const start = clamp(config.liveStartTime, 0, source.mediaDuration! - LIVE_DURATION)
      const cover = clamp(config.liveCoverTime, 0, MAX_COVER_TIME)
      const tempPrefix = `.${name}_live_${stamp}`
      const tempVideoName = `${tempPrefix}.mp4`
      const tempImageName = `${tempPrefix}.jpg`
      const tempVideoPath = filePath(exportDir, tempVideoName)
      const tempImagePath = filePath(exportDir, tempImageName)

      try {
        await Promise.all(liveFormats.map((format) => report(format, 0, 'exporting')))
        await exportPreviewVideo({
          exportDir,
          fileName: tempVideoName,
          width: resolved.width,
          height: resolved.height,
          layers: offsetVideoLayers(source.layers!, start, LIVE_DURATION),
          fps: resolved.fps,
          qualityPreset: resolved.qualityPreset ?? 'high',
          renderTaskId: `workspace_live_render_${stamp}`,
          onProgress: async (videoPercent) => {
            const totalPercent = Math.min(89, Math.max(1, Math.round(videoPercent * 0.9)))
            await Promise.all(liveFormats.map((format) => report(format, totalPercent, 'exporting')))
          },
        })
        await Promise.all(liveFormats.map((format) => report(format, 90, 'exporting')))
        await exportPreviewImage({
          exportDir,
          fileName: tempImageName,
          width: resolved.width,
          height: resolved.height,
          layers: offsetVideoLayers(source.layers!, start + cover, LIVE_DURATION),
          format: 'jpeg',
          quality: 100,
        })
        await Promise.all(liveFormats.map((format) => report(format, 95, 'exporting')))

        for (const format of liveFormats) {
          try {
            await report(format, 96, 'exporting')
            const result = await window.luna.workspace.exportRenderedLivePhoto(
              `${name}_${format === 'apple-live' ? 'apple_live' : 'google_live'}`,
              tempImagePath,
              tempVideoPath,
              format === 'apple-live',
              true,
              false,
              cover,
            )
            await report(format, 100, 'done', result.path)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await report(format, 100, 'failed', undefined, message)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await Promise.all(liveFormats.map((format) => report(format, 100, 'failed', undefined, message)))
      } finally {
        await window.luna.deleteLocalFiles([tempVideoPath, tempImagePath]).catch(() => {})
      }
    })().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      await Promise.all(formats.map((format) => report(format, 100, 'failed', undefined, message)))
    })
  }, 0)

  return { taskId: task.id }
}
