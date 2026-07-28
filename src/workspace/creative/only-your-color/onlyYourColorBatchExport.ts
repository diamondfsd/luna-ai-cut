import { exportPreviewImage } from '../../../components/previewStageExport'
import { canUseLunaUltraWatermark } from '../../../hooks/useLunaUltraWatermark'
import type { WorkspaceMediaAsset, WorkspaceOnlyYourColorState, WorkspaceProject } from '../../../shared/types'
import { usesCustomWatermark } from '../../../shared/watermarkGeometry'
import type { EditPipeline } from '../../shared/editPipeline'
import { outputSizeForTransform } from '../../shared/renderLayerPipeline'
import { buildWorkspaceExportLayers } from '../../shared/workspaceExportLayers'
import { loadCreativeImageSize } from '../shared/creativeMedia'
import { buildOnlyYourColorLayers } from './onlyYourColorLayers'
import { ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID, ONLY_YOUR_COLOR_MASK_LAYER_ID } from './onlyYourColorMask'
import { resolveOnlyYourColorBatchMask } from './onlyYourColorBatchMask'
import { onlyYourColorStateForAsset } from './onlyYourColorState'

export interface OnlyYourColorBatchSource {
  asset: WorkspaceMediaAsset
  pipeline: EditPipeline
}

interface OnlyYourColorBatchExportOptions {
  project: WorkspaceProject
  sources: OnlyYourColorBatchSource[]
  onProgress?: (label: string) => void
}

export interface OnlyYourColorBatchExportResult {
  exportedCount: number
  failedCount: number
  recognizedStates: Record<string, WorkspaceOnlyYourColorState>
}

function outputBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'only-your-color'
}

function outputPath(exportDir: string, fileName: string): string {
  return `${exportDir.replace(/[\\/]$/, '')}/${fileName}`
}

export async function exportOnlyYourColorBatch(options: OnlyYourColorBatchExportOptions): Promise<OnlyYourColorBatchExportResult> {
  if (options.sources.length === 0) throw new Error('请选择需要导出的图片')
  const settings = await window.luna.getSettings()
  if (!settings.exportDir) throw new Error('请先在设置中选择导出目录')
  const exportDir = settings.exportDir

  const stamp = Date.now()
  const entries = options.sources.map(({ asset, pipeline }, index) => {
    const suffix = options.sources.length > 1 ? `-${index + 1}` : ''
    const fileName = `${outputBaseName(asset.name)}-only-your-color-${stamp}${suffix}.png`
    return {
      asset,
      pipeline,
      fileName,
      outputPath: outputPath(exportDir, fileName),
      itemId: `only_your_color_${stamp}_${index}`,
    }
  })
  const task = await window.luna.exportTask.create('只有你的色彩', entries.map((entry) => ({
    id: entry.itemId,
    sourcePath: entry.asset.path,
    outputPath: entry.outputPath,
    label: '创意图片',
  })))

  let exportedCount = 0
  let failedCount = 0
  const recognizedStates: Record<string, WorkspaceOnlyYourColorState> = {}
  for (const [index, entry] of entries.entries()) {
    const currentTask = await window.luna.exportTask.get(task.id).catch(() => undefined)
    if (currentTask?.items.find((item) => item.id === entry.itemId)?.status === 'canceled') continue
    options.onProgress?.(`处理 ${index + 1}/${entries.length}`)
    await window.luna.exportTask.updateItem(task.id, entry.itemId, {
      status: 'exporting',
      progress: 5,
      label: '正在准备主体',
    }).catch(() => undefined)
    try {
      const mask = await resolveOnlyYourColorBatchMask({
        projectId: options.project.id,
        asset: entry.asset,
        savedState: onlyYourColorStateForAsset(options.project, entry.asset.id),
        api: {
          loadMask: (projectId, path) => window.luna.workspace.loadColorMask(projectId, path),
          segment: (request) => window.luna.workspace.segmentImage(request),
          saveMask: (projectId, assetId, width, height, bytes) => (
            window.luna.workspace.saveColorMask(projectId, assetId, width, height, bytes, 1)
          ),
        },
      })
      if (mask.newlyRecognized) recognizedStates[entry.asset.id] = mask.state
      const latestTask = await window.luna.exportTask.get(task.id).catch(() => undefined)
      if (latestTask?.items.find((item) => item.id === entry.itemId)?.status === 'canceled') continue

      const subjectLayer = entry.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_MASK_LAYER_ID)
      const backgroundLayer = entry.pipeline.colorMasks.find((layer) => layer.id === ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID)
      const renderPipeline: EditPipeline = {
        ...entry.pipeline,
        colorMasks: entry.pipeline.colorMasks.filter((layer) => (
          layer.id !== ONLY_YOUR_COLOR_MASK_LAYER_ID && layer.id !== ONLY_YOUR_COLOR_BACKGROUND_MASK_LAYER_ID
        )),
      }
      const resolution = await loadCreativeImageSize(entry.asset)
      const metadata = renderPipeline.border.enabled
        ? await window.luna.getMediaMetadataByPath(entry.asset.path).catch(() => ({ groups: [] }))
        : null
      const allowWatermark = usesCustomWatermark(renderPipeline.watermark)
        || await canUseLunaUltraWatermark(entry.asset.path, entry.asset.kind)
      const baseLayers = buildWorkspaceExportLayers(entry.asset.path, resolution, renderPipeline, metadata, allowWatermark)
      const outputSize = outputSizeForTransform(resolution, renderPipeline.transform)
      const effectLayers = buildOnlyYourColorLayers({
        layers: baseLayers,
        sourcePath: entry.asset.path,
        subjectMaskPath: mask.state.maskPath!,
        backgroundMaskPath: mask.state.maskPath!,
        intensity: mask.state.intensity,
        backgroundExposure: mask.state.backgroundExposure ?? 0,
        subjectSaturation: mask.state.subjectSaturation ?? 0,
        subjectVibrance: mask.state.subjectVibrance ?? 0,
        subjectMaskInverted: subjectLayer?.inverted,
        backgroundMaskInverted: backgroundLayer?.inverted,
        subjectMaskFeather: subjectLayer?.feather,
        backgroundMaskFeather: backgroundLayer?.feather,
      })
      await window.luna.exportTask.updateItem(task.id, entry.itemId, { progress: 25, label: '正在导出' }).catch(() => undefined)
      await exportPreviewImage({
        exportDir,
        fileName: entry.fileName,
        width: outputSize.width,
        height: outputSize.height,
        layers: effectLayers,
        format: 'png',
        quality: 100,
        exportTaskId: task.id,
        exportItemId: entry.itemId,
      })
      exportedCount += 1
    } catch (error) {
      failedCount += 1
      const message = error instanceof Error ? error.message : '图片导出失败'
      await window.luna.exportTask.updateItem(task.id, entry.itemId, { status: 'failed', error: message }).catch(() => undefined)
    }
  }
  return { exportedCount, failedCount, recognizedStates }
}
