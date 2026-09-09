import { exportPreviewImage } from '../../../components/previewStageExport'
import { createDirectoryExportNameAllocator } from '../../../lib/exportNameAllocator'
import { rememberTransferDirectory, resolveTransferDirectory } from '../../../lib/transferDirectory'
import type { PreviewLayer, WorkspaceMediaAsset } from '../../../shared/types'

interface ExportOnlyYourColorImageOptions {
  asset: WorkspaceMediaAsset
  layers: PreviewLayer[]
  width: number
  height: number
}

export async function exportOnlyYourColorImage(options: ExportOnlyYourColorImageOptions): Promise<void> {
  const settings = await window.luna.getSettings()
  if (!settings.exportDir && !settings.chooseTransferDirectoryBeforeAction) throw new Error('请先在设置中选择导出目录')
  const exportDir = await resolveTransferDirectory('export', settings)
  if (!exportDir) return
  if (settings.chooseTransferDirectoryBeforeAction) await rememberTransferDirectory('export', exportDir, settings)
  const stamp = Date.now()
  const allocateName = await createDirectoryExportNameAllocator(exportDir)
  const name = options.asset.name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'only-your-color'
  const fileName = allocateName(`${name}-only-your-color.png`)
  const outputPath = `${exportDir.replace(/[\\/]$/, '')}/${fileName}`
  const itemId = `only_your_color_${stamp}`
  const task = await window.luna.exportTask.create('只有你的色彩', [{ id: itemId, sourcePath: options.asset.path, outputPath, label: '创意图片' }])
  try {
    await exportPreviewImage({
      exportDir,
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
