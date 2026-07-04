import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'

/**
 * 水印叠加层 — 暂不计算位置
 * 水印位置计算已移除，由 Native Core 后端完成。
 */
export function WorkspaceWatermarkOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()

  const { settings } = edit.previewPipeline.watermark
    ? { settings: edit.previewPipeline.watermark }
    : { settings: edit.pipeline.watermark }
  const { imageRect } = canvas

  // 水印位置计算已移除，由 Native Core 后端完成
  console.log('[WorkspaceWatermarkOverlay] 水印设置:', { settings, imageRect })

  return null
}
