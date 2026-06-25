import { useMemo, useState } from 'react'
import { X } from 'lucide-react'

import { MediaPreviewPanel } from './MediaPreviewPanel'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToPreviewUrl } from './previewModalUtils'
import type { DeviceWatermarkStyleConfig, LunaFile, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { BaseModal, Button, IconButton } from '../ui'
import '../styles/modal.css'
import '../styles/export-modal.css'

interface ExportModalProps {
  files: LunaFile[]
  watermarkSettings: WatermarkSettingsType
  watermarkStyleOptions?: DeviceWatermarkStyleConfig[]
  exporting: boolean
  onClose: () => void
  onConfirm: (settings: WatermarkSettingsType) => void
  onSettingsChange: (settings: WatermarkSettingsType) => void
}

export function ExportModal({
  files,
  watermarkSettings,
  watermarkStyleOptions,
  exporting,
  onClose,
  onConfirm,
  onSettingsChange,
}: ExportModalProps) {
  const [currentFile, setCurrentFile] = useState<LunaFile>(files[0])

  const displaySource = useMemo(() => {
    const localPath = currentFile.downloadFilePath ?? currentFile.localPath
    return localPath ? filePathToPreviewUrl(localPath) : null
  }, [currentFile])

  return (
    <BaseModal onClose={onClose}>
      <section className="preview-modal">
        <header>
          <div>
            <span className="eyebrow">导出设置</span>
            <h2>
              导出 · {files.length} 个文件
            </h2>
          </div>
          <div className="preview-actions">
            <IconButton variant="light" icon={<X size={18} />} onClick={onClose} title="关闭" />
          </div>
        </header>

        <div className="preview-body">
          {/* Left: file preview */}
          <MediaPreviewPanel
            files={files}
            currentFile={currentFile}
            displaySource={displaySource}
            onFileChange={setCurrentFile}
            watermarkSettings={watermarkSettings}
          />

          {/* Right: export options */}
          <div className="export-options-panel">
            <div className="export-options-header">
              <span>导出选项</span>
            </div>

            <div className="export-options-body">
              <WatermarkSettings
                settings={watermarkSettings}
                onChange={onSettingsChange}
                styleOptions={watermarkStyleOptions}
              />
            </div>

            <div className="export-options-footer">
              <Button variant="secondary" size="compact" onClick={onClose} disabled={exporting}>
                取消
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={exporting}
                onClick={() => onConfirm(watermarkSettings)}
              >
                {exporting ? '导出中...' : '确认导出'}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </BaseModal>
  )
}
