import { useCallback, useState } from 'react'
import { ExportSettingsPanel, type VideoExportSettings } from './ExportSettingsPanel'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
import type { PreviewLayer } from '../shared/types'
import { Button, Dialog } from '../ui'
import { ExportPreviewPane, type ExportPreviewSource } from './ExportPreviewPane'
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
  previewSource?: ExportPreviewSource
  livePhotoSource?: {
    path: string
    startTime: number
    duration: number
    thumbnailDuration: number
    layers: PreviewLayer[]
    outputSize: { width: number; height: number }
  }
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
  previewSource,
  livePhotoSource,
  onConfirm,
}: ExportSettingsDialogProps) {
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)
  const [internalLoading, setInternalLoading] = useState(false)

  const liveSelected = exportConfig.exportFormats.some((format) => format !== 'video')
  const selectedDuration = livePhotoSource
    ? (exportConfig.trimEndTime ?? livePhotoSource.duration) - exportConfig.trimStartTime
    : 0
  const livePhotoInvalid = exportConfig.exportFormats.length === 0
    || (liveSelected && (!livePhotoSource || selectedDuration < 3))
  const isBusy = loading || internalLoading

  const handleConfirm = useCallback(async () => {
    if (isBusy) return
    setInternalLoading(true)
    try {
      await onConfirm(exportConfig)
      setExportConfig(DEFAULT_VIDEO_EXPORT_SETTINGS)
      onOpenChange(false)
    } finally {
      setInternalLoading(false)
    }
  }, [isBusy, onConfirm, exportConfig, onOpenChange])

  const handleConfigChange = useCallback((config: VideoExportSettings) => {
    setExportConfig(config)
  }, [])

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
      className={`workspace-export-dialog-content${previewSource ? ' preview-mode' : ''}`}
      closeOnMaskClick={false}
      footer={
        <div className="workspace-export-footer">
          <div className="workspace-export-footer-spacer" />
          <div className="workspace-export-footer-actions">
            <Button variant="secondary" size="compact" onClick={() => handleOpenChange(false)} disabled={isBusy}>
              取消
            </Button>
            <Button variant="primary" size="compact" onClick={handleConfirm} disabled={isBusy || livePhotoInvalid}>
              {isBusy ? confirmLoadingLabel : confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      <div className={`workspace-export-body${previewSource ? ' has-preview' : ''}`}>
        {previewSource ? (
          <ExportPreviewPane
            source={previewSource}
            livePhotoSource={livePhotoSource}
            value={exportConfig}
            onChange={handleConfigChange}
          />
        ) : null}
        <div className="workspace-export-settings-column">
          <ExportSettingsPanel value={exportConfig} onChange={handleConfigChange} livePhotoSource={livePhotoSource} />
        </div>
      </div>
    </Dialog>
  )
}
