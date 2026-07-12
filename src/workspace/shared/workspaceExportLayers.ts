import { buildLayers } from '../../components/PreviewStage'
import { buildExportLayers } from '../../components/previewStageExport'
import type { PreviewLayer, MediaMetadata } from '../../shared/types'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from './renderLayerPipeline'
import type { EditPipeline } from './editPipeline'
import { buildBorderLayer } from '../border/buildBorderLayer'

export function buildWorkspaceExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  pipeline: EditPipeline,
  borderMetadata?: MediaMetadata | null,
): PreviewLayer[] {
  const main = buildLayers(sourcePath)
  if (main[0]) {
    main[0] = {
      ...main[0],
      color: pipelineColorToRenderColor(pipeline.color),
      transform: pipelineTransformToRenderTransform(pipeline.transform),
      lutId: pipeline.lutFilter.activeId ?? undefined,
      lutIntensity: pipeline.lutFilter.intensity,
    }
  }

  const layers = buildExportLayers(sourcePath, resolution, pipeline.watermark)
  const result = main[0] ? [{ ...layers[0], ...main[0] }, ...layers.slice(1)] : layers

  // 边框层（如果有元数据）
  if (pipeline.border.enabled && borderMetadata !== undefined) {
    const borderLayers = buildBorderLayer({
      canvasWidth: resolution.width,
      canvasHeight: resolution.height,
      border: pipeline.border,
      metadata: borderMetadata,
      mediaPath: sourcePath,
      mediaLayerStyle: {
        color: pipelineColorToRenderColor(pipeline.color),
        transform: pipelineTransformToRenderTransform(pipeline.transform),
        lutId: pipeline.lutFilter.activeId ?? undefined,
        lutIntensity: pipeline.lutFilter.intensity,
      },
    })
    result.push(...borderLayers)
  }

  return result
}
