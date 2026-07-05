import { useCallback, useEffect, useState } from 'react'
import { exportBatchFiles } from './previewStageExport'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { filePathToPreviewUrl, isImagePath, isVideoPath } from '../lib/fileUtils'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { Dialog, toast } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  filePath: string
  filePathList?: string[]
  previewOnly?: boolean
  batchExportMode?: boolean
  onClose: () => void
}

export function PreviewModal({
  filePath,
  filePathList,
  previewOnly,
  batchExportMode,
  onClose,
}: PreviewModalProps) {
  // ── 当前预览文件路径 ──
  const [currentFilePath, setCurrentFilePath] = useState(filePath)

  // 外部 filePath 变化时重置
  useEffect(() => {
    setCurrentFilePath(filePath)
  }, [filePath])

  // ── 状态 ──
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkLayers, setWatermarkLayers] = useState<PreviewLayer[]>([])
  const [mediaSize, setMediaSize] = useState<{ w: number; h: number } | null>(null)
  const [batchExporting, setBatchExporting] = useState(false)

  const displaySource = filePathToPreviewUrl(currentFilePath) ?? currentFilePath
  const isVideo = isVideoPath(currentFilePath)
  const isImage = isImagePath(currentFilePath)

  // 获取媒体分辨率用于水印布局匹配
  useEffect(() => {
    if (previewOnly) return
    setMediaSize(null)
    setWatermarkLayers([])
    if (!currentFilePath) return
    let canceled = false
    window.luna.workspace.getMediaResolution(currentFilePath)
      .then(({ width, height }) => {
        if (!canceled) setMediaSize({ w: width, h: height })
      })
      .catch(() => {
        if (!canceled) setMediaSize(null)
      })
    return () => {
      canceled = true
    }
  }, [currentFilePath, previewOnly])

  // 当前文件分辨率（用于批量导出时展示文件信息）
  const [currentResolution, setCurrentResolution] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (!currentFilePath) return
    let canceled = false
    window.luna.workspace.getMediaResolution(currentFilePath)
      .then((res) => { if (!canceled) setCurrentResolution(res) })
      .catch(() => { if (!canceled) setCurrentResolution(null) })
    return () => { canceled = true }
  }, [currentFilePath])

  // WatermarkSettings onChange 回调
  function handleWatermarkChange(_settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkLayers(layer ? [layer] : [])
  }

  // ── 批量导出（委托给公共方法） ──
  const handleBatchExport = useCallback(async () => {
    if (batchExporting || !filePathList?.length) return
    setBatchExporting(true)

    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) { toast.error('导出目录未配置'); return }

      await exportBatchFiles(filePathList, settings.exportDir, watermarkLayers)
      toast.success(`导出完成: ${filePathList.length} 个文件`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchExporting(false)
    }
  }, [batchExporting, filePathList, watermarkLayers])

  // Escape 关闭
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open variant="fullscreen" onOpenChange={(o) => !o && onClose()}>
      <section className="preview-modal">
        <PreviewModalHeader
          filePath={currentFilePath}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          onClose={onClose}
          previewOnly={previewOnly}
          batchExportMode={batchExportMode}
          exportFilesCount={filePathList?.length}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            {previewOnly ? (
              <div className="preview-stage">
                {isVideo && (
                  <video
                    key={currentFilePath}
                    src={displaySource}
                    controls
                    autoPlay
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}
                {isImage && (
                  <img
                    key={currentFilePath}
                    src={displaySource}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                )}
              </div>
            ) : (
              <PreviewStage
                url={displaySource}
                extraLayers={watermarkLayers}
                pending={mediaSize == null}
                exportOptions={{ enable: true }}
              />
            )}

            {batchExportMode && (
              <div className="batch-export-footer">
                <div className="batch-file-info">
                  <span className="batch-file-name">{currentFilePath.split(/[/\\]/).pop()}</span>
                  {currentResolution && (
                    <span className="batch-file-resolution">
                      {currentResolution.width} × {currentResolution.height}
                    </span>
                  )}
                  <span className={`batch-file-kind ${isVideo ? 'video' : 'image'}`}>
                    {isVideo ? '视频' : '图片'}
                  </span>
                </div>
                <button
                  className="ui-btn ui-btn-primary batch-export-btn"
                  disabled={batchExporting}
                  onClick={handleBatchExport}
                  type="button"
                >
                  {batchExporting ? '导出中...' : `确认导出 (${filePathList?.length ?? 0} 个文件)`}
                </button>
              </div>
            )}

            <PreviewThumbnailStrip
              filePathList={filePathList ?? [currentFilePath]}
              initialFilePath={currentFilePath}
              onChange={(fp) => setCurrentFilePath(fp)}
            />
          </div>

          {inspectorOpen && (
            <MediaInspector
              filePath={currentFilePath}
              onToggleCollapse={() => setInspectorOpen(false)}
              header={!previewOnly ? (
                <WatermarkSettings
                  onChange={handleWatermarkChange}
                  filePath={currentFilePath}
                  mediaWidth={mediaSize?.w}
                  mediaHeight={mediaSize?.h}
                />
              ) : undefined}
            />
          )}
        </div>
      </section>
    </Dialog>
  )
}
