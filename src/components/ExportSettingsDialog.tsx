import { useCallback, useState } from 'react'
import { ExportSettingsPanel, type VideoExportSettings } from './ExportSettingsPanel'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
import { Button, Dialog } from '../ui'
import './ExportSettingsDialog.css'

interface ExportSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  confirmLabel?: string
  confirmLoadingLabel?: string
  loading?: boolean
  tone?: 'default' | 'dark'
  onConfirm: (config: VideoExportSettings) => void | Promise<void>
}

/**
 * 通用导出设置弹窗
 *
 * 封装 ExportSettingsPanel + Dialog，统一工作台编辑和创意模式的导出配置弹窗样式。
 * 不关心具体导出逻辑，通过 onConfirm 回调交由消费方处理。
 *
 * 用法：
 * ```tsx
 * <ExportSettingsDialog
 *   open={dialogOpen}
 *   onOpenChange={setDialogOpen}
 *   onConfirm={(config) => handleExport(config)}
 * />
 * ```
 */
export function ExportSettingsDialog({
  open,
  onOpenChange,
  title = '导出设置',
  description,
  confirmLabel = '确认导出',
  confirmLoadingLabel = '加入中...',
  loading = false,
  tone = 'default',
  onConfirm,
}: ExportSettingsDialogProps) {
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)
  const [internalLoading, setInternalLoading] = useState(false)

  const isBusy = loading || internalLoading

  const handleConfirm = useCallback(async () => {
    if (isBusy) return
    setInternalLoading(true)
    try {
      await onConfirm(exportConfig)
      onOpenChange(false)
    } finally {
      setInternalLoading(false)
    }
  }, [isBusy, onConfirm, exportConfig, onOpenChange])

  // 关闭时重置配置
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setExportConfig(DEFAULT_VIDEO_EXPORT_SETTINGS)
      setInternalLoading(false)
    }
    onOpenChange(nextOpen)
  }, [onOpenChange])

  return (
    <Dialog
      open={open}
      tone={tone}
      onOpenChange={handleOpenChange}
      title={title}
      description={description}
      className="workspace-export-dialog-content"
      closeOnMaskClick={false}
      footer={
        <div className="workspace-export-footer">
          <div className="workspace-export-footer-spacer" />
          <div className="workspace-export-footer-actions">
            <Button variant="secondary" size="compact" onClick={() => onOpenChange(false)} disabled={isBusy}>
              取消
            </Button>
            <Button variant="primary" size="compact" onClick={handleConfirm} disabled={isBusy}>
              {isBusy ? confirmLoadingLabel : confirmLabel}
            </Button>
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
