import { buildLayers } from '../../components/PreviewStage'
import { buildResolvedWatermarkStaticLayer } from '../../components/WatermarkSettings'
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
  const main = buildLayers(sourcePath, 'contain', resolution, exportCanvasFor(resolution))
  if (main[0]) {
    main[0] = {
      ...main[0],
      color: pipelineColorToRenderColor(pipeline.color),
      transform: pipelineTransformToRenderTransform(pipeline.transform),
    }
  }

  const wm = pipeline.watermark
  if (!wm?.enabled || !wm?.imagePath || !wm.wmAspect) return main

  const watermarkLayer = buildResolvedWatermarkStaticLayer(wm, resolution.width, resolution.height)
  const baseLayer = main[0]
  if (!watermarkLayer || !baseLayer) return main

  return [
    ...main,
    {
      ...watermarkLayer,
      dstX: baseLayer.dstX + watermarkLayer.dstX * baseLayer.dstW,
      dstY: baseLayer.dstY + watermarkLayer.dstY * baseLayer.dstH,
      dstW: watermarkLayer.dstW * baseLayer.dstW,
      dstH: watermarkLayer.dstH * baseLayer.dstH,
    },
  ]
}
