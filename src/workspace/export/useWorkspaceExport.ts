import { useCallback } from 'react'

import { useApp } from '../../context/AppContext'
import type { LunaFile, MediaKind, WorkspaceMediaAsset } from '../../shared/types'
import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { logger } from '../../lib/rendererLogger'

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

  return useCallback(async () => {
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

      // 图片/视频统一走 ffmpeg 调色导出（同一套 filter）
      const { whiteBalanceMode, gradeShadowsHue, gradeMidHue, gradeHighlightsHue, curve, ...rest } = pipeline.color
      toast.success(`已开始导出${isVid ? '视频' : '图片'}`)
      logger.info(`[Export] 开始导出`, { exportId, taskName, path: activeMedia.path, isVid })
      result = await window.luna.workspace.exportColor(activeMedia.path, rest as Record<string, number>, { exportId, taskName })
      logger.info(`[Export] 导出完成`, { exportId, result })
      setExportSnapshots((current) => new Map(current).set(exportId, snapshotForAsset(activeMedia, result.path, isVid ? 'video' : 'image')))

      setExportProgress((current) => new Map(current).set(exportId, {
        exportId,
        taskId,
        taskName,
        createdAt,
        fileName: result.name,
        index: 0,
        totalFiles: 1,
        percent: 100,
        status: 'done',
        destinationPath: result.path,
      }))
      toast.success('已导出到文件夹')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setExportProgress((current) => new Map(current).set(exportId, {
        exportId,
        taskId,
        taskName,
        createdAt,
        fileName: activeMedia.name,
        index: 0,
        totalFiles: 1,
        percent: null,
        status: 'failed',
        error: message,
      }))
      toast.error(message)
    } finally {
      setExporting(false)
    }
  }, [activeMedia, canvasRef, imageRect, pipeline.watermark, setExporting, setExportProgress, setExportSnapshots])
}
