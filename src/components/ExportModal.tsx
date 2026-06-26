import { useMemo, useState } from 'react'
import { ImagePlus, Monitor, Video, X } from 'lucide-react'

import { MediaPreviewPanel } from './MediaPreviewPanel'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToPreviewUrl } from './previewModalUtils'
import type { DeviceWatermarkStyleConfig, LunaFile, VideoExportSettings, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
import { Accordion, BaseModal, Button, IconButton, Select } from '../ui'
import '../styles/modal.css'
import '../styles/export-modal.css'

interface ExportModalProps {
  files: LunaFile[]
  watermarkSettings: WatermarkSettingsType
  watermarkStyleOptions?: DeviceWatermarkStyleConfig[]
  exporting: boolean
  onClose: () => void
  onConfirm: (settings: WatermarkSettingsType, videoSettings: VideoExportSettings) => void
  onSettingsChange: (settings: WatermarkSettingsType) => void
}

const RESOLUTION_OPTIONS = [
  { value: 'original' as const, label: '原始' },
  { value: '1080p' as const, label: '1080p' },
  { value: '720p' as const, label: '720p' },
]

const FRAME_RATE_OPTIONS = [
  { value: 'original' as const, label: '原始' },
  { value: '30' as const, label: '30fps' },
  { value: '60' as const, label: '60fps' },
  { value: '24' as const, label: '24fps' },
  { value: '25' as const, label: '25fps' },
]

const QUALITY_OPTIONS = [
  { value: 'original' as const, label: '原始画质' },
  { value: 'high' as const, label: '高质量' },
  { value: 'medium' as const, label: '标准' },
  { value: 'low' as const, label: '压缩小体积' },
]

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
  const [videoSettings, setVideoSettings] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)

  const displaySource = useMemo(() => {
    const localPath = currentFile.downloadFilePath ?? currentFile.localPath
    return localPath ? filePathToPreviewUrl(localPath) : null
  }, [currentFile])

  const hasVideoFiles = useMemo(() => files.some((f) => f.kind === 'video'), [files])

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
              <Accordion title={<><ImagePlus size={14} /> 水印设置</>} defaultOpen>
                <WatermarkSettings
                  settings={watermarkSettings}
                  onChange={onSettingsChange}
                  styleOptions={watermarkStyleOptions}
                  showToggle={false}
                />
              </Accordion>

              {hasVideoFiles && (
                <Accordion title={<><Video size={14} /> 视频输出</>} defaultOpen>
                  <div className="video-export-setting-row">
                    <span className="video-export-setting-label">
                      <Monitor size={13} />
                      分辨率
                    </span>
                    <Select
                      variant="compact"
                      options={RESOLUTION_OPTIONS}
                      value={videoSettings.resolution}
                      onValueChange={(v) => setVideoSettings((prev) => ({ ...prev, resolution: v as VideoExportSettings['resolution'] }))}
                    />
                  </div>

                  <div className="video-export-setting-row">
                    <span className="video-export-setting-label">帧率</span>
                    <Select
                      variant="compact"
                      options={FRAME_RATE_OPTIONS}
                      value={videoSettings.frameRate}
                      onValueChange={(v) => setVideoSettings((prev) => ({ ...prev, frameRate: v as VideoExportSettings['frameRate'] }))}
                    />
                  </div>

                  <div className="video-export-setting-row">
                    <span className="video-export-setting-label">画质</span>
                    <Select
                      variant="compact"
                      options={QUALITY_OPTIONS}
                      value={videoSettings.quality}
                      onValueChange={(v) => setVideoSettings((prev) => ({ ...prev, quality: v as VideoExportSettings['quality'] }))}
                    />
                  </div>
                </Accordion>
              )}
            </div>

            <div className="export-options-footer">
              <Button variant="secondary" size="compact" onClick={onClose} disabled={exporting}>
                取消
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={exporting}
                onClick={() => onConfirm(watermarkSettings, videoSettings)}
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
