import { useCallback } from 'react'

import { useApp } from '../../context/AppContext'
import type { LunaFile, MediaKind, WorkspaceMediaAsset } from '../../shared/types'
import { toast } from '../../ui'
import type { EditPipeline } from '../shared/editPipeline'
import { logger } from '../../lib/rendererLogger'
import { canExportFFmpeg } from '../shared/canExportFFmpeg'
import { exportWithFFmpeg } from './exportFFmpeg'
import { exportImageWithWebGL } from './exportImageWithWebGL'
import { exportVideoWithWebGL } from './exportVideoWithWebGL'
import { composeWorkspaceExport } from './exportWorkspaceImage'

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

      // ── 后端选择：优先 FFmpegFast，回退 WebGLExact ──
      const useFFmpeg = canExportFFmpeg(pipeline)

      if (isVid && useFFmpeg) {
        // ── FFmpegFast 视频导出：ffmpeg 解码→调色→编码，完全绕过 WebGL ──
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
        // ── WebGLExact 视频导出（兜底）：WebGL shader 逐帧调色 → ffmpeg 仅编码 ──
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

        // 视频导出完成后，从主进程获取最终路径（通过 endVideoExport 已返回）
        result = { path: '', name: activeMedia.name }
        toast.success('已导出到文件夹')
      } else if (!isVid && useFFmpeg) {
        // ── FFmpegFast 图片导出：ffmpeg 直接滤镜处理 ──
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
        // ── WebGL 图片导出：WebGL shader 全分辨率 → toBlob → 保存 ──
        toast.success('已开始导出图片（高精度模式）')
        logger.info(`[Export WebGL] 开始导出图片`, { exportId, taskName, path: activeMedia.path })

        const blob = await exportImageWithWebGL(activeMedia.path, pipeline)

        // 应用水印
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
}
