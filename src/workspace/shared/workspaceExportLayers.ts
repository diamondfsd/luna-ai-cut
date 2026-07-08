import { buildLayers } from '../../components/PreviewStage'
import { buildExportLayers } from '../../components/previewStageExport'
import type { PreviewLayer } from '../../shared/types'
import { pipelineColorToRenderColor, pipelineTransformToRenderTransform } from './renderLayerPipeline'
import type { EditPipeline } from './editPipeline'

function exportCanvasFor(resolution: { width: number; height: number }): { width: number; height: number } {
  const max = 1440
  const aspect = resolution.width / resolution.height
  if (aspect >= 1) return { width: max, height: Math.round(max / aspect) }
  return { width: Math.round(max * aspect), height: max }
}

export function buildWorkspaceExportLayers(
  sourcePath: string,
  resolution: { width: number; height: number },
  pipeline: EditPipeline,
): PreviewLayer[] {
  const main = buildLayers(sourcePath, resolution, exportCanvasFor(resolution))
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
  return main[0] ? [{ ...layers[0], ...main[0] }, ...layers.slice(1)] : layers
}
