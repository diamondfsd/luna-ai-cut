import { buildLayers } from '../../components/PreviewStage'
import { buildExportLayers } from '../../components/previewStageExport'
import type { PreviewLayer, MediaMetadata } from '../../shared/types'
import { applyBorderMediaLayout, buildLocalColorLayers, outputSizeForTransform, pipelineColorToRenderColor, pipelineTransformToRenderTransform } from './renderLayerPipeline'
import type { EditPipeline } from './editPipeline'
import { buildBorderLayer } from '../border/buildBorderLayer'

export function buildWorkspaceExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  pipeline: EditPipeline,
  borderMetadata: MediaMetadata | null | undefined,
  allowWatermark: boolean,
): PreviewLayer[] {
  const finalCanvasSize = outputSizeForTransform(resolution, pipeline.transform)
  const main = buildLayers(sourcePath)
  if (main[0]) {
    const trimStart = pipeline.trim?.startTime
    const trimEnd = pipeline.trim?.endTime
    main[0] = applyBorderMediaLayout({
      ...main[0],
      color: pipelineColorToRenderColor(pipeline.color),
      transform: pipelineTransformToRenderTransform(pipeline.transform),
      lutId: pipeline.lutFilter.activeId ?? undefined,
      lutIntensity: pipeline.lutFilter.intensity,
      // 截取：设置视频起始时间和有效时长
      ...(trimStart != null ? { videoTime: trimStart } : {}),
      ...(trimStart != null && trimEnd != null ? { videoDuration: trimEnd - trimStart } : {}),
    }, pipeline.border)
  }

  const layers = buildExportLayers(sourcePath, finalCanvasSize, allowWatermark ? pipeline.watermark : null)
  const result = main[0] ? [{ ...layers[0], ...main[0] }, ...layers.slice(1)] : layers
  if (result[0]) result.splice(1, 0, ...buildLocalColorLayers(result[0], pipeline))

  // 边框层（如果有元数据）
  if (pipeline.border.enabled && borderMetadata !== undefined) {
    const borderLayers = buildBorderLayer({
      canvasWidth: finalCanvasSize.width,
      canvasHeight: finalCanvasSize.height,
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
