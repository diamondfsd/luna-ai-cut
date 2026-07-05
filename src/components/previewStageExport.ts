import type { PreviewLayer, RenderLayer, StaticLayer } from '../shared/types'
import { buildLayers } from './PreviewStage'

interface LunaRenderCoreApi {
  exportImageFromSources(
    outputPath: string,
    width: number,
    height: number,
    layers: PreviewLayer[],
    format: string,
    quality: number,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
  exportVideo(
    inputPath: string,
    outputPath: string,
    canvasWidth: number,
    canvasHeight: number,
    fps: number | null,
    hardware: boolean,
    videoLayer: RenderLayer,
    overlayLayers: StaticLayer[],
    taskId?: string,
    qualityPreset?: string,
    exportTaskId?: string,
    exportItemId?: string,
  ): Promise<void>
}

function lrc(): LunaRenderCoreApi {
  const api = (window as unknown as { lunaRenderCore?: LunaRenderCoreApi }).lunaRenderCore
  if (!api) throw new Error('渲染引擎未初始化')
  return api
}

function outputPath(exportDir: string, fileName: string): string {
  return exportDir.endsWith('/') ? `${exportDir}${fileName}` : `${exportDir}/${fileName}`
}

function staticLayers(layers: PreviewLayer[]): StaticLayer[] {
  return layers
    .filter((layer) => !layer.isVideo)
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map((layer) => ({
      imagePath: layer.filePath,
      dstX: layer.dstX,
      dstY: layer.dstY,
      dstW: layer.dstW,
      dstH: layer.dstH,
      srcX: layer.srcX ?? 0,
      srcY: layer.srcY ?? 0,
      srcW: layer.srcW ?? 1,
      srcH: layer.srcH ?? 1,
      opacity: layer.opacity ?? 1,
      zIndex: layer.zIndex ?? 0,
      color: layer.color,
      transform: layer.transform,
    }))
}

export async function exportPreviewImage(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  format: 'jpeg' | 'png' | 'webp'
  quality: number
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
}): Promise<{ path: string; name: string }> {
  const path = outputPath(params.exportDir, params.fileName)
  await lrc().exportImageFromSources(path, params.width, params.height, params.layers, params.format, params.quality, params.exportTaskId, params.exportItemId)
  return { path, name: params.fileName }
}

export async function exportPreviewVideo(params: {
  exportDir: string
  fileName: string
  width: number
  height: number
  layers: PreviewLayer[]
  qualityPreset?: string
  /** 导出任务 ID（写入任务记录） */
  exportTaskId?: string
  /** 子任务 ID */
  exportItemId?: string
}): Promise<{ path: string; name: string }> {
  const videoSourceLayer = params.layers.find((layer) => layer.isVideo)
  if (!videoSourceLayer) throw new Error('未找到视频图层')

  const path = outputPath(params.exportDir, params.fileName)
  const videoLayer: RenderLayer = {
    textureId: 0,
    dstX: videoSourceLayer.dstX,
    dstY: videoSourceLayer.dstY,
    dstW: videoSourceLayer.dstW,
    dstH: videoSourceLayer.dstH,
    srcX: videoSourceLayer.srcX ?? 0,
    srcY: videoSourceLayer.srcY ?? 0,
    srcW: videoSourceLayer.srcW ?? 1,
    srcH: videoSourceLayer.srcH ?? 1,
    opacity: videoSourceLayer.opacity ?? 1,
    zIndex: videoSourceLayer.zIndex ?? 0,
    color: videoSourceLayer.color,
    transform: videoSourceLayer.transform,
  }

  await lrc().exportVideo(
    videoSourceLayer.filePath,
    path,
    params.width,
    params.height,
    null,
    true,
    videoLayer,
    staticLayers(params.layers),
    undefined,
    params.qualityPreset ?? 'high',
    params.exportTaskId,
    params.exportItemId,
  )
  return { path, name: params.fileName }
}

export async function exportPreviewLivePhoto(params: {
  name: string
  exportDir: string
  width: number
  height: number
  imageLayers: PreviewLayer[]
  videoLayers: PreviewLayer[]
  appleLivePhoto: boolean
}): Promise<{ path: string; name: string }> {
  const stamp = Date.now()
  const outputDir = params.exportDir.replace(/[\\/]$/, '')
  const imagePath = `${outputDir}/${params.name}_live_image_${stamp}.jpg`
  const videoPath = `${outputDir}/${params.name}_live_video_${stamp}.mp4`

  await lrc().exportImageFromSources(imagePath, params.width, params.height, params.imageLayers, 'jpeg', 100)
  await exportPreviewVideo({
    exportDir: outputDir,
    fileName: `${params.name}_live_video_${stamp}.mp4`,
    width: params.width,
    height: params.height,
    layers: params.videoLayers,
    qualityPreset: 'high',
  })

  return window.luna.workspace.exportRenderedLivePhoto(params.name, imagePath, videoPath, params.appleLivePhoto)
}

// ── 公共批量导出 ──

/**
 * 批量导出多个文件
 *
 * 职责：
 * - 创建导出任务（exportTask）
 * - 为每个文件获取分辨率、构建渲染层
 * - 调用 lrc 逐文件导出（图片/视频自动分流）
 * - 返回 taskId 和 items 信息
 *
 * PreviewModal 等 UI 组件调用此方法，不直接处理 lrc 细节。
 */
export async function exportBatchFiles(
  sourcePaths: string[],
  exportDir: string,
  overlayLayers: PreviewLayer[],
): Promise<{ taskId: string; completed: number; failed: number; items: Array<{ id: string; outputPath: string }> }> {
  // 生成子任务列表
  const items = sourcePaths.map((fp) => {
    const baseName = fp.split(/[/\\]/).pop() || 'export'
    const isVid = isVideoPathCached(fp)
    const ext = isVid ? '.mp4' : '.jpg'
    return {
      id: `batch_${baseName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sourcePath: fp,
      outputPath: `${exportDir.replace(/[\\/]$/, '')}/${baseName.replace(/\.[^.]+$/, '')}_${Date.now()}${ext}`,
    }
  })

  // 创建导出任务
  const task = await window.luna.exportTask.create(
    `批量导出 ${sourcePaths.length} 个文件`,
    items.map((i) => ({ id: i.id, sourcePath: i.sourcePath, outputPath: i.outputPath })),
  )

  let completed = 0
  let failed = 0

  // 逐个导出，单个失败不影响后续
  for (let i = 0; i < sourcePaths.length; i++) {
    const fp = sourcePaths[i]
    const item = items[i]
    const isVid = isVideoPathCached(fp)

    try {
      const res = await window.luna.workspace.getMediaResolution(fp)
      const mainLayers = buildLayers(fp)
      const exportLayers = overlayLayers.length > 0 ? [...mainLayers, ...overlayLayers] : mainLayers

      if (isVid) {
        await exportPreviewVideo({
          exportDir,
          fileName: item.outputPath.split('/').pop() || 'export.mp4',
          width: res.width, height: res.height,
          layers: exportLayers, qualityPreset: 'high',
          exportTaskId: task.id, exportItemId: item.id,
        })
      } else {
        await exportPreviewImage({
          exportDir,
          fileName: item.outputPath.split('/').pop() || 'export.jpg',
          width: res.width, height: res.height,
          layers: exportLayers, format: 'jpeg', quality: 100,
          exportTaskId: task.id, exportItemId: item.id,
        })
      }
      completed++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      // 记录失败信息到通用导出任务
      await window.luna.exportTask.updateItem(task.id, item.id, {
        status: 'failed',
        error: message,
      }).catch(() => {})
    }
  }

  return { taskId: task.id, completed, failed, items: items.map((i) => ({ id: i.id, outputPath: i.outputPath })) }
}

/** 内部：根据扩展名判断是否视频 */
function isVideoPathCached(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'mts', 'insv', 'lrv'].includes(ext)
}
