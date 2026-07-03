import { useCallback } from 'react'

import { useApp } from '../../context/AppContext'
import type { ExportProgress, LunaFile, MediaKind, WorkspaceMediaAsset } from '../../shared/types'
import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { logger } from '../../lib/rendererLogger'
import { canExportFFmpeg } from '../shared/canExportFFmpeg'
import { exportWithFFmpeg } from './exportFFmpeg'
import { exportImageWithWebGL } from './exportImageWithWebGL'
import { exportVideoWithWebGL } from './exportVideoWithWebGL'
import { composeWorkspaceExport } from './exportWorkspaceImage'

/** 带并发限制的异步 map */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

interface UseWorkspaceExportOptions {
  activeMedia: WorkspaceMediaAsset | null
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  imageRect: { x: number; y: number; width: number; height: number }
  pipeline: EditPipeline
}

const VIDEO_EXTS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'])

function isVideoPath(path: string): boolean {
  const segments = path.split('.')
  const ext = segments.length > 1 ? segments[segments.length - 1].toLowerCase() : ''
  return VIDEO_EXTS.has(ext)
}

function snapshotForAsset(asset: WorkspaceMediaAsset, exportedPath?: string, kind?: MediaKind): LunaFile {
  const isVid = kind === 'video' || (exportedPath ? isVideoPath(exportedPath) : asset.kind === 'video')
  return {
    id: `${asset.id}:workspace-export`,
    name: asset.name,
    href: asset.name,
    sourceUrl: exportedPath ?? asset.path,
    url: exportedPath ?? asset.path,
    dateText: '',
    timeText: '',
    sizeText: '',
    bytes: null,
    kind: kind ?? (isVid ? 'video' : 'image'),
    extension: isVid ? (asset.name.split('.').pop() ?? 'mp4') : 'png',
    capturedAt: null,
    groupDay: '',
    groupHour: '',
    videoKey: null,
    previewName: null,
    previewUrl: null,
    cacheFilePath: null,
    downloadFilePath: exportedPath ?? asset.path,
    thumbnailUrl: asset.thumbnailUrl ?? null,
    isLivePhoto: false,
    livePhotoVideoName: null,
    livePhotoVideoUrl: null,
    livePhotoCacheFilePath: null,
    downloadName: asset.name,
    canPreview: true,
    localPath: exportedPath ?? asset.path,
  }
}

export function useWorkspaceExport({ activeMedia, canvasRef, imageRect, pipeline }: UseWorkspaceExportOptions) {
  const { setExportProgress, setExportSnapshots, setExporting } = useApp()

  const exportSingle = useCallback(async () => {
    if (!activeMedia || !canvasRef.current) return
    const createdAt = Date.now()
    const taskId = `workspace_export_${createdAt}`
    const taskName = activeMedia.kind === 'video' ? '导出工作台视频' : '导出工作台图片'
    const exportId = `${activeMedia.name}_${createdAt}`
    const isVid = activeMedia.kind === 'video'

    setExporting(true)
    setExportSnapshots((current) => new Map(current).set(exportId, snapshotForAsset(activeMedia)))
    setExportProgress((current) => new Map(current).set(exportId, {
      exportId,
      taskId,
      taskName,
      createdAt,
      fileName: activeMedia.name,
      index: 0,
      totalFiles: 1,
      percent: 0,
      status: 'exporting',
    }))

    try {
      let result: { name: string; path: string }

      // ── 后端选择：优先 FFmpegFast，回退 WebGLExact ──
      const useFFmpeg = canExportFFmpeg(pipeline)

      if (isVid && useFFmpeg) {
        toast.success('已开始极速导出')
        logger.info(`[Export FFmpegFast] 开始导出视频`, { exportId, taskName, path: activeMedia.path })

        result = await exportWithFFmpeg(
          activeMedia.path,
          pipeline,
          { exportId, taskName, onProgress: (percent) => {
            setExportProgress((current) => new Map(current).set(exportId, {
              exportId, taskId, taskName, createdAt,
              fileName: activeMedia.name, index: 0, totalFiles: 1,
              percent, status: percent >= 100 ? 'done' : 'exporting',
            }))
          }},
        )

        toast.success('已导出到文件夹')
      } else if (isVid) {
        toast.success('已开始导出视频（高精度模式）')
        logger.info(`[Export WebGLExact] 开始导出视频`, { exportId, taskName, path: activeMedia.path })

        await exportVideoWithWebGL({
          sourcePath: activeMedia.path,
          pipeline,
          exportId,
          taskName,
          onProgress: (percent) => {
            setExportProgress((current) => new Map(current).set(exportId, {
              exportId, taskId, taskName, createdAt,
              fileName: activeMedia.name, index: 0, totalFiles: 1,
              percent, status: percent >= 100 ? 'done' : 'exporting',
            }))
          },
        })

        result = { path: '', name: activeMedia.name }
        toast.success('已导出到文件夹')
      } else if (!isVid && useFFmpeg) {
        toast.success('已开始极速导出')
        logger.info(`[Export FFmpegFast] 开始导出图片`, { exportId, taskName, path: activeMedia.path })

        result = await exportWithFFmpeg(
          activeMedia.path,
          pipeline,
          { exportId, taskName, onProgress: (percent) => {
            setExportProgress((current) => new Map(current).set(exportId, {
              exportId, taskId, taskName, createdAt,
              fileName: activeMedia.name, index: 0, totalFiles: 1,
              percent, status: percent >= 100 ? 'done' : 'exporting',
            }))
          }},
        )

        toast.success('已导出到文件夹')
      } else {
        toast.success('已开始导出图片（高精度模式）')
        logger.info(`[Export WebGL] 开始导出图片`, { exportId, taskName, path: activeMedia.path })

        const blob = await exportImageWithWebGL(activeMedia.path, pipeline)
        const exportUrl = await composeWorkspaceExport(
          canvasRef.current,
          imageRect,
          pipeline.watermark,
          blob,
        )

        result = await window.luna.workspace.exportImage(activeMedia.name, exportUrl)
        logger.info(`[Export WebGL] 图片导出完成`, { exportId, result })
        toast.success('已导出到文件夹')
      }

      setExportSnapshots((current) => new Map(current).set(exportId, snapshotForAsset(activeMedia, result?.path, isVid ? 'video' : 'image')))
      setExportProgress((current) => new Map(current).set(exportId, {
        exportId, taskId, taskName, createdAt,
        fileName: activeMedia.name, index: 0, totalFiles: 1,
        percent: 100, status: 'done',
        destinationPath: result?.path,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportProgress((current) => new Map(current).set(exportId, {
        exportId, taskId, taskName, createdAt,
        fileName: activeMedia.name, index: 0, totalFiles: 1,
        percent: null, status: 'failed', error: message,
      }))
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }, [activeMedia, canvasRef, imageRect, pipeline, setExporting, setExportProgress, setExportSnapshots])

  const exportBatch = useCallback(async (indices: number[], allMediaL: WorkspaceMediaAsset[]) => {
    if (indices.length === 0) return
    console.log('[exportBatch] 开始批量导出', { indices, totalMedia: allMediaL.length })
    setExporting(true)

    // 收集有效导出项
    const exportItems: Array<{ asset: WorkspaceMediaAsset; exportId: string; createdAt: number }> = []
    const failedItems: Array<{ name: string; error: string }> = []
    for (const mediaIdx of indices) {
      const asset = allMediaL[mediaIdx]
      if (!asset) { failedItems.push({ name: `索引 ${mediaIdx}`, error: '无效' }); continue }
      if (!canExportFFmpeg(pipeline)) { failedItems.push({ name: asset.name, error: '不支持批量导出' }); continue }
      const createdAt = Date.now()
      const exportId = `${asset.name}_batch_${createdAt}`
      exportItems.push({ asset, exportId, createdAt })
    }

    if (exportItems.length === 0) {
      setExporting(false)
      toast.error('批量导出全部失败')
      return
    }

    const batchTs = Date.now()
    const taskName = `批量导出 ${exportItems.length} 个文件`

    console.log('[exportBatch] 准备创建任务', {
      taskName,
      items: exportItems.map(i => ({ exportId: i.exportId, name: i.asset.name, kind: i.asset.kind })),
    })

    // 1. 创建任务，包含所有明细
    const task = await window.luna.workspace.createExportTask(
      taskName,
      exportItems.map(({ asset, exportId }) => ({
        exportId,
        fileName: asset.name,
        kind: asset.kind === 'video' ? 'video' : 'image',
      })),
    )

    console.log('[exportBatch] 任务创建完成', { taskId: task.id, totalCount: task.totalCount, itemCount: task.items.length, itemExportIds: task.items.map(i => i.exportId) })

    // 2. 初始化进度（全部 queued）+ snapshots
    const snapshots = new Map<string, LunaFile>()
    const queued = new Map<string, ExportProgress>()
    for (const { asset, exportId } of exportItems) {
      snapshots.set(exportId, snapshotForAsset(asset))
      queued.set(exportId, {
        exportId,
        taskId: task.id,
        taskName,
        createdAt: batchTs,
        fileName: asset.name,
        index: 0,
        totalFiles: exportItems.length,
        percent: 0,
        status: 'queued',
      })
    }
    setExportSnapshots((current) => new Map([...current, ...snapshots]))
    setExportProgress((current) => new Map([...current, ...queued]))

    // 3. 并发导出（图片 4 路，视频 1 路）
    const serializedPipeline = JSON.parse(JSON.stringify(pipeline))
    const completed: Array<{ name: string; path: string }> = []
    const failed: Array<{ name: string; error: string }> = [...failedItems]

    const exportOne = async ({ asset, exportId, createdAt }: typeof exportItems[number]) => {
      setExportProgress((current) => new Map(current).set(exportId, {
        ...current.get(exportId)!,
        status: 'exporting',
      }))
      try {
        console.log('[exportBatch] 开始导出:', { exportId, name: asset.name, kind: asset.kind, path: asset.path, taskId: task.id })
        const result = await window.luna.workspace.exportFFmpeg(
          asset.path,
          serializedPipeline,
          { exportId, taskName, taskId: task.id, fileName: asset.name, index: 0, totalFiles: exportItems.length, createdAt },
        )
        console.log('[exportBatch] 导出成功:', { exportId, name: asset.name, result })
        completed.push({ name: asset.name, path: result.path })
        setExportSnapshots((current) => new Map(current).set(exportId, snapshotForAsset(asset, result.path)))
        setExportProgress((current) => new Map(current).set(exportId, {
          ...current.get(exportId)!,
          percent: 100,
          status: 'done',
          destinationPath: result.path,
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failed.push({ name: asset.name, error: message })
        setExportProgress((current) => new Map(current).set(exportId, {
          ...current.get(exportId)!,
          percent: null,
          status: 'failed',
          error: message,
        }))
      }
    }

    const imageItems = exportItems.filter(({ asset }) => asset.kind !== 'video')
    const videoItems = exportItems.filter(({ asset }) => asset.kind === 'video')
    await Promise.all([
      runWithConcurrency(imageItems, 4, exportOne),
      runWithConcurrency(videoItems, 1, exportOne),
    ])

    console.log('[exportBatch] 全部完成', { completed, failed })

    setExporting(false)
    if (completed.length > 0) toast.success(`成功导出 ${completed.length} 个文件${failed.length > 0 ? `，${failed.length} 个失败` : ''}`)
    if (failed.length > 0 && completed.length === 0) toast.error('批量导出全部失败')
  }, [pipeline, setExporting, setExportProgress, setExportSnapshots])

  return { exportSingle, exportBatch }
}
