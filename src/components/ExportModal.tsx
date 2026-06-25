import { useMemo, useState } from 'react'
import { FileQuestion, Film, Play, X } from 'lucide-react'

import { WatermarkOverlay } from './WatermarkOverlay'
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
  const [fileIndex, setFileIndex] = useState(0)
  const currentFile = files[fileIndex]

  const displaySource = useMemo(() => {
    if (!currentFile) return null
    const localPath = currentFile.downloadFilePath ?? currentFile.localPath
    return localPath ? filePathToPreviewUrl(localPath) : null
  }, [currentFile])

  const [hasPrevious, hasNext] = useMemo(() => {
    return [fileIndex > 0, fileIndex < files.length - 1]
  }, [fileIndex, files.length])

  function navigateFile(direction: -1 | 1): void {
    const next = fileIndex + direction
    if (next < 0 || next >= files.length) return
    setFileIndex(next)
  }

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
          <div className="preview-stage-col">
            <div className="preview-stage">
              {currentFile?.kind === 'image' && displaySource ? (
                <div className="preview-media-inner">
                  <img
                    src={displaySource}
                    alt={currentFile.name}
                    style={{ maxWidth: '100%', maxHeight: '100%' }}
                  />
                  <WatermarkOverlay settings={watermarkSettings} kind="image" />
                </div>
              ) : currentFile?.kind === 'video' && displaySource ? (
                <div className="preview-media-inner">
                  <video
                    src={displaySource}
                    controls
                    autoPlay
                    style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
                  />
                  <WatermarkOverlay settings={watermarkSettings} kind="video" />
                </div>
              ) : (
                <div className="unknown-preview">
                  <FileQuestion size={48} />
                  <span>无法预览</span>
                </div>
              )}

              {hasPrevious && (
                <button className="preview-nav previous" onClick={() => navigateFile(-1)} title="上一个">
                  <Play size={18} style={{ transform: 'rotate(180deg)' }} />
                </button>
              )}
              {hasNext && (
                <button className="preview-nav next" onClick={() => navigateFile(1)} title="下一个">
                  <Play size={18} />
                </button>
              )}
            </div>

            {/* Thumbnail strip */}
            <div className="preview-thumbnails">
              {files.map((file) => {
                const isActive = file.id === currentFile?.id
                const thumbSrc = file.thumbnailUrl ?? null
                return (
                  <button
                    key={file.id}
                    className={`preview-thumb-item${isActive ? ' active' : ''}`}
                    onClick={() => setFileIndex(files.findIndex((f) => f.id === file.id))}
                    title={file.name}
                  >
                    {thumbSrc ? (
                      <img src={thumbSrc} alt={file.name} loading="lazy" />
                    ) : (
                      <span className="preview-thumb-placeholder">
                        {file.kind === 'video' ? <Film size={14} /> : <FileQuestion size={14} />}
                      </span>
                    )}
                    {file.kind === 'video' && (
                      <span className="preview-thumb-badge">
                        <Play size={8} fill="currentColor" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

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
