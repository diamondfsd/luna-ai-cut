import { buildLayers } from '../../components/PreviewStage'
import { buildExportLayers } from '../../components/previewStageExport'
import type { PreviewLayer, MediaMetadata, WorkspaceSubtitleTrack } from '../../shared/types'
import { applyBorderMediaLayout, applyLocalColorToSourceMediaLayers, buildLocalColorPrecomposition, outputSizeForTransform, pipelineColorToRenderColor, pipelineTransformToRenderTransform, placeWatermarkOnFramedContent } from './renderLayerPipeline'
import type { EditPipeline } from './editPipeline'
import { buildBorderLayer } from '../border/buildBorderLayer'
import { buildSubtitleLayers } from '../subtitles/subtitleLayers'

export function buildWorkspaceExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  pipeline: EditPipeline,
  borderMetadata: MediaMetadata | null | undefined,
  allowWatermark: boolean,
  subtitles?: WorkspaceSubtitleTrack,
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
      restoreLutId: pipeline.logRestore.activeId ?? undefined,
      lutId: pipeline.lutFilter.activeId ?? undefined,
      lutIntensity: pipeline.lutFilter.intensity,
      // 截取：设置视频起始时间和有效时长
      ...(trimStart != null ? { videoTime: trimStart } : {}),
      ...(trimStart != null && trimEnd != null ? { videoDuration: trimEnd - trimStart } : {}),
    }, pipeline.border)
  }

  const layers = buildExportLayers(sourcePath, finalCanvasSize, allowWatermark ? pipeline.watermark : null)
  const watermarkLayers = layers.slice(1)
  const result = main[0] ? [{ ...layers[0], ...main[0] }] : layers.slice(0, 1)
  if (result[0]) result.splice(0, 1, ...buildLocalColorPrecomposition(result[0], pipeline, 'workspace-export-local-color'))

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
        restoreLutId: pipeline.logRestore.activeId ?? undefined,
        lutId: pipeline.lutFilter.activeId ?? undefined,
        lutIntensity: pipeline.lutFilter.intensity,
      },
    })
    const adjustedBorderLayers = applyLocalColorToSourceMediaLayers(borderLayers, sourcePath, pipeline)
    result.push(
      ...placeWatermarkOnFramedContent(watermarkLayers, adjustedBorderLayers),
      ...adjustedBorderLayers,
    )
  } else {
    result.push(...watermarkLayers)
  }

  const trimStartMs = Math.round((pipeline.trim?.startTime ?? 0) * 1_000)
  const trimEndMs = pipeline.trim?.endTime == null ? Number.MAX_SAFE_INTEGER : Math.round(pipeline.trim.endTime * 1_000)
  result.push(...buildSubtitleLayers(subtitles, finalCanvasSize, { startMs: trimStartMs, endMs: trimEndMs }))
  return result
}
