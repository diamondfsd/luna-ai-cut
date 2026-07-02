import type { ExportFileInput, WatermarkSettings } from '../src/shared/types'
import { resolveWatermarkRatios } from '../src/shared/watermark/layoutConfig'

/**
 * 从设备配置表获取水印宽度比。用于替代原有的 watermarkPercent。
 * 若查表失败，返回 0.15（15%，常见默认值）。
 */
function getWidthRatio(file: ExportFileInput, settings: WatermarkSettings): number {
  const deviceId = file.watermarkProfileId ?? file.sourceDeviceId ?? null
  const ratios = resolveWatermarkRatios(deviceId, settings.style, 1920, 1080, settings.position)
  return ratios?.widthRatio ?? 0.15
}

/**
 * 解析水印样式。样式直接从 settings 获取。
 */
export async function resolveWatermarkStyleForFile(_file: ExportFileInput, settings: WatermarkSettings): Promise<string> {
  return settings.style
}

/**
 * 解析完整水印设置。返回包含 widthPercent（表驱动的水印宽度百分比）的设置。
 * widthPercent 供后端 ffmpeg 使用，兼容原有 watermarkPercent 参数。
 */
export async function resolveWatermarkSettingsForFile(
  file: ExportFileInput,
  settings: WatermarkSettings,
): Promise<WatermarkSettings & { widthPercent: number }> {
  const widthRatio = getWidthRatio(file, settings)
  return {
    ...settings,
    widthPercent: Math.round(widthRatio * 100),
  }
}

