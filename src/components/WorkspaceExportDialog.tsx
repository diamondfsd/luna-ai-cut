import { useCallback, useState } from 'react'
import { exportBatchFiles, type BatchExportSource } from './previewStageExport'
import { ExportSettingsPanel, type VideoExportSettings } from './ExportSettingsPanel'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
import { Dialog, toast } from '../ui'
import './WorkspaceExportDialog.css'

interface WorkspaceExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sources: BatchExportSource[]
  exportDir: string
}

/**
 * 工作台导出弹窗
 *
 * 用于工作台点击导出时弹出，让用户选择分辨率/码率/帧率等导出参数。
 * 仅在导出文件包含视频时显示（图片直接导出，不弹窗）。
 *
 * 用法：
 * ```tsx
 * <WorkspaceExportDialog
 *   open={dialogOpen}
 *   onOpenChange={setDialogOpen}
 *   sources={sources}
 *   exportDir={settings.exportDir}
 * />
 * ```
 */
export function WorkspaceExportDialog({
  open,
  onOpenChange,
  sources,
  exportDir,
}: WorkspaceExportDialogProps) {
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)
  const [exporting, setExporting] = useState(false)

  const handleConfirm = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      await exportBatchFiles(sources, exportDir, exportConfig)
      toast.success(`已加入导出队列: ${sources.length} 个文件`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }, [exporting, sources, exportDir, exportConfig, onOpenChange])

  // 弹窗关闭时重置配置
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setExportConfig(DEFAULT_VIDEO_EXPORT_SETTINGS)
      setExporting(false)
    }
    onOpenChange(nextOpen)
  }, [onOpenChange])

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title="导出设置"
      description={`将导出 ${sources.length} 个文件`}
      className="workspace-export-dialog-content"
      closeOnMaskClick={false}
      footer={
        <div className="workspace-export-footer">
          <div className="workspace-export-footer-spacer" />
          <div className="workspace-export-footer-actions">
            <button
              className="workspace-export-secondary-btn"
              onClick={() => onOpenChange(false)}
              disabled={exporting}
            >
              取消
            </button>
            <button
              className="workspace-export-primary-btn"
              onClick={handleConfirm}
              disabled={exporting}
            >
              {exporting ? '加入中...' : '确认导出'}
            </button>
          </div>
        </div>
      }
    >
      <div className="workspace-export-body">
        <ExportSettingsPanel value={exportConfig} onChange={setExportConfig} />
      </div>
    </Dialog>
  )
}
