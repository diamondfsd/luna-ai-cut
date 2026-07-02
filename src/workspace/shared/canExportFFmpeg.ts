import type { EditPipeline } from './editPipeline'

/**
 * 检查当前 pipeline 是否可以使用 FFmpegFast 导出。
 *
 * FFmpegFast 支持：
 * - 所有基础调色（曝光、亮度、对比度、饱和度、色温、色调等）
 * - 三路色轮（shadows/mid/highlights）
 * - 曲线（ToneCurve → curves filter）
 * - Levels（colorlevels filter）
 * - HSL 调整（hsl filter）
 * - 清晰度/纹理/锐化/降噪（unsharp/hqdn3d filter）
 * - 裁剪/旋转/翻转（crop/rotate/transpose filter）
 * - 缩放（scale filter）
 * - 水印（overlay filter）
 *
 * 不支持（需回退 WebGLExact）：
 * - AI 特效（如果有）
 * - 自定义 GLSL shader
 *
 * 当前几乎所有功能都可映射到 ffmpeg filter，所以默认返回 true。
 * 引入无法映射的新特效时在此添加否决条件。
 */
export function canExportFFmpeg(_pipeline: EditPipeline): boolean {
  return true

  // 未来如果有 AI / 自定义 shader 等无法映射到 ffmpeg 的功能，在此添加检查：
  // if (pipeline.effects.aiEnabled) return false
}
