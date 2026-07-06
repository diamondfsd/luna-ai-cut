import { useCallback, useEffect, useState } from 'react'
import { exportBatchFiles } from './previewStageExport'
import { HtmlPreview } from './HtmlPreview'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { useFileCache } from '../hooks/useFileCache'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import type { PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { Button, Dialog, toast } from '../ui'
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
  const [batchEnqueuing, setBatchEnqueuing] = useState(false)

  // 解析远程文件：HTTP URL → 缓存到本地，与 MediaCard 逻辑一致
  const { cacheFilePath: resolvedPath } = useFileCache(currentFilePath)

  const displaySource = resolvedPath
    ? (filePathToPreviewUrl(resolvedPath) ?? resolvedPath)
    : (currentFilePath?.startsWith('http') ? null : filePathToPreviewUrl(currentFilePath) ?? currentFilePath)

  useEffect(() => {
    setWatermarkLayers([])
  }, [currentFilePath])

  // WatermarkSettings onChange 回调
  function handleWatermarkChange(_settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkLayers(layer ? [layer] : [])
  }

  // ── 批量导出（委托给公共方法） ──
  const handleBatchExport = useCallback(async () => {
    if (batchEnqueuing || !filePathList?.length) return
    setBatchEnqueuing(true)

    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) { toast.error('导出目录未配置'); return }

      await exportBatchFiles(filePathList, settings.exportDir, watermarkLayers)
      toast.success(`已加入导出队列: ${filePathList.length} 个文件`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchEnqueuing(false)
    }
  }, [batchEnqueuing, filePathList, watermarkLayers])

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
                <HtmlPreview url={displaySource} />
              </div>
            ) : (
              <PreviewStage
                url={displaySource}
                extraLayers={watermarkLayers}
                exportOptions={{ enable: true }}
              />
            )}

            <PreviewThumbnailStrip
              filePathList={filePathList ?? [currentFilePath]}
              initialFilePath={currentFilePath}
              onChange={(fp) => setCurrentFilePath(fp)}
            />
          </div>

          {inspectorOpen && (
            <div className={`preview-sidebar${batchExportMode ? ' batch-export-sidebar' : ''}`}>
              <MediaInspector
                filePath={currentFilePath}
                onToggleCollapse={() => setInspectorOpen(false)}
                header={!previewOnly ? (
                  <WatermarkSettings
                    onChange={handleWatermarkChange}
                    filePath={currentFilePath}
                  />
                ) : undefined}
              />
              {batchExportMode && (
                <div className="batch-export-actions">
                  <Button
                    variant="primary"
                    disabled={batchEnqueuing}
                    onClick={handleBatchExport}
                    type="button"
                    style={{ width: '100%' }}
                  >
                    {batchEnqueuing ? '加入中...' : `确认导出 (${filePathList?.length ?? 0} 个文件)`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </Dialog>
  )
}
