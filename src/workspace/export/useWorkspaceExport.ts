import { useCallback } from 'react'

import { useApp } from '../../context/AppContext'
import type { LunaFile, WorkspaceMediaAsset } from '../../shared/types'
import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { composeWorkspaceExport } from './exportWorkspaceImage'

interface UseWorkspaceExportOptions {
  activeMedia: WorkspaceMediaAsset | null
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  imageRect: { x: number; y: number; width: number; height: number }
  pipeline: EditPipeline
}

function snapshotForAsset(asset: WorkspaceMediaAsset, exportedPath?: string): LunaFile {
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
    kind: 'image',
    extension: 'png',
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
    const taskName = `导出工作台图片`
    const exportId = `${activeMedia.name}_${createdAt}`
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
      const dataUrl = await composeWorkspaceExport(canvasRef.current, imageRect, pipeline.watermark)
      const result = await window.luna.workspace.exportImage(activeMedia.name, dataUrl)
      setExportSnapshots((current) => new Map(current).set(exportId, snapshotForAsset(activeMedia, result.path)))
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
