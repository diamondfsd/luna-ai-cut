import { exportPreviewImage } from '../../../components/previewStageExport'
import { createDirectoryExportNameAllocator } from '../../../lib/exportNameAllocator'
import type { PreviewLayer, WorkspaceMediaAsset } from '../../../shared/types'

interface ExportPixelStretchImageOptions {
  asset: WorkspaceMediaAsset
  layers: PreviewLayer[]
  width: number
  height: number
  exportDir: string
}

export async function exportPixelStretchImage(options: ExportPixelStretchImageOptions): Promise<void> {
  const stamp = Date.now()
  const allocateName = await createDirectoryExportNameAllocator(options.exportDir)
  const name = options.asset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'pixel-stretch'
  const fileName = allocateName(`${name}-pixel-stretch.png`)
  const outputPath = `${options.exportDir.replace(/[\\/]$/, '')}/${fileName}`
  const itemId = `pixel_stretch_${stamp}`
  const task = await window.luna.exportTask.create('像素拉伸', [{ id: itemId, sourcePath: options.asset.path, outputPath, label: '创意图片' }])
  try {
    await exportPreviewImage({
      exportDir: options.exportDir,
      fileName,
      width: options.width,
      height: options.height,
      layers: options.layers,
      format: 'png',
      quality: 100,
      exportTaskId: task.id,
      exportItemId: itemId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片导出失败'
    await window.luna.exportTask.updateItem(task.id, itemId, { status: 'failed', error: message }).catch(() => undefined)
    throw error
  }
}
