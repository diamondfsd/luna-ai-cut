import type { EditPipeline } from '../shared/editPipeline'
import { logger } from '../../lib/rendererLogger'

/**
 * 使用 FFmpegFast 后端导出图片/视频。
 *
 * 整个流程在 main process 的 ffmpeg 中完成：
 *   输入文件 → ffmpeg filter(调色+裁剪+水印) → 编码 → 输出文件
 *
 * 完全绕过 WebGL readPixels 链路。
 */
export async function exportWithFFmpeg(
  sourcePath: string,
  pipeline: EditPipeline,
  options: {
    exportId: string
    taskName: string
    onProgress?: (percent: number) => void
  },
): Promise<{ path: string; name: string }> {
  const { exportId, taskName, onProgress } = options

  const hasColor = Object.values(pipeline.color).some(
    (v) => typeof v === 'number' && v !== 0,
  )
  logger.info(`[FFmpegFast] 开始导出`, {
    exportId, taskName, sourcePath,
    hasColor,
    hasTransform: !!pipeline.transform?.crop || pipeline.transform?.rotate !== 0,
    hasWatermark: pipeline.watermark?.enabled,
  })

  // 详细记录所有参数，用于排查预览和导出一致性问题
  logger.info(`[FFmpegFast] 调色参数详情`, {
    exportId,
    color: {
      exposure: pipeline.color.exposure,
      brightness: pipeline.color.brightness,
      contrast: pipeline.color.contrast,
      saturation: pipeline.color.saturation,
      vibrance: pipeline.color.vibrance,
      temperature: pipeline.color.temperature,
      tint: pipeline.color.tint,
      shadows: pipeline.color.shadows,
      highlights: pipeline.color.highlights,
      whites: pipeline.color.whites,
      blacks: pipeline.color.blacks,
      levelsBlack: pipeline.color.levelsBlack,
      levelsWhite: pipeline.color.levelsWhite,
      clarity: pipeline.color.clarity,
      texture: pipeline.color.texture,
      sharpen: pipeline.color.sharpen,
      denoise: pipeline.color.denoise,
      // 颜色分级
      gradeShadowsAmount: pipeline.color.gradeShadowsAmount,
      gradeShadowsHue: pipeline.color.gradeShadowsHue,
      gradeMidAmount: pipeline.color.gradeMidAmount,
      gradeMidHue: pipeline.color.gradeMidHue,
      gradeHighlightsAmount: pipeline.color.gradeHighlightsAmount,
      gradeHighlightsHue: pipeline.color.gradeHighlightsHue,
      // 曲线 — 只记点数
      curvePoints: {
        rgb: pipeline.color.curve.points.rgb.length,
        luminance: pipeline.color.curve.points.luminance.length,
        red: pipeline.color.curve.points.red.length,
        green: pipeline.color.curve.points.green.length,
        blue: pipeline.color.curve.points.blue.length,
      },
      // HSL
      hslSat: pipeline.color.hslSat,
      hslHue: pipeline.color.hslHue,
      hslLum: pipeline.color.hslLum,
    },
    transform: pipeline.transform,
    watermark: {
      enabled: pipeline.watermark.enabled,
      style: pipeline.watermark.style,
      position: pipeline.watermark.position,
    },
  })

  // 序列化 pipeline（去掉不可序列化的字段）
  const serializedPipeline = JSON.parse(JSON.stringify(pipeline))

  const result = await window.luna.workspace.exportFFmpeg(
    sourcePath,
    serializedPipeline,
    { exportId, taskName },
    (percent: number) => {
      onProgress?.(percent)
    },
  )

  logger.info(`[FFmpegFast] 导出完成`, { exportId, result })
  return result
}
