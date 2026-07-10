import { useCallback, useEffect, useState } from 'react'
import { buildExportLayers, exportBatchFiles, type BatchExportSource } from './previewStageExport'
import { ExportSettingsPanel, type VideoExportSettings } from './ExportSettingsPanel'
import { HtmlPreview } from './HtmlPreview'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { useFileCache } from '../hooks/useFileCache'
import { filePathToPreviewUrl } from '../lib/fileUtils'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
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

function toLocalPath(filePath: string | null): string | null {
  if (!filePath) return null
  if (!filePath.startsWith('file://')) return filePath
  try {
    return decodeURIComponent(new URL(filePath).pathname)
  } catch {
    return filePath
  }
}

function isHttpPath(filePath: string | null): boolean {
  return Boolean(filePath?.startsWith('http'))
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
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType | null>(null)
  const [batchEnqueuing, setBatchEnqueuing] = useState(false)
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)

  // 解析远程文件：HTTP URL → 缓存到本地，与 MediaCard 逻辑一致
  const { cacheFilePath: resolvedPath } = useFileCache(currentFilePath)

  const isRemoteSource = isHttpPath(currentFilePath)
  const activeSourcePath = isRemoteSource ? resolvedPath : currentFilePath
  const displaySource = activeSourcePath ? (filePathToPreviewUrl(activeSourcePath) ?? activeSourcePath) : null
  const stageSource = toLocalPath(activeSourcePath)

  useEffect(() => {
    console.log('[PreviewModal] source changed', {
      currentFilePath,
      resolvedPath,
      activeSourcePath,
      displaySource,
      stageSource,
    })
    setWatermarkLayers([])
  }, [currentFilePath, displaySource, resolvedPath, stageSource])

  // WatermarkSettings onChange 回调
  function handleWatermarkChange(settings: WatermarkSettingsType, layer?: PreviewLayer) {
    setWatermarkSettings(settings)
    setWatermarkLayers(layer ? [layer] : [])
  }

  // ── 导出（批量/单帧统一走 exportBatchFiles） ──
  const handleExport = useCallback(async () => {
    if (batchEnqueuing) return
    setBatchEnqueuing(true)

    try {
      const settings = await window.luna.getSettings()
      if (!settings.exportDir) { toast.error('导出目录未配置'); return }

      const exportList = batchExportMode ? (filePathList ?? []) : [currentFilePath]
      const sources: BatchExportSource[] = await Promise.all(exportList.map(async (sourcePath) => {
        const resolution = await window.luna.workspace.getMediaResolution(sourcePath)
        return {
          sourcePath,
          layers: buildExportLayers(sourcePath, resolution, watermarkSettings),
        }
      }))

      await exportBatchFiles(sources, settings.exportDir, exportConfig)
      toast.success(`已加入导出队列 (${sources.length} 个文件)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchEnqueuing(false)
    }
  }, [batchEnqueuing, filePathList, currentFilePath, watermarkSettings, exportConfig])

  // Escape 关闭
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <Dialog open variant="fullscreen" closeOnMaskClick={false} onOpenChange={(o) => !o && onClose()}>
      <section className="preview-modal">
        <PreviewModalHeader
          filePath={currentFilePath}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          onClose={onClose}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            {previewOnly ? (
              <div className="preview-stage">
                <HtmlPreview url={displaySource} />
              </div>
            ) : (
              <PreviewStage
                url={stageSource}
                extraLayers={watermarkLayers}
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
              {!previewOnly && (
                <>
                  <ExportSettingsPanel value={exportConfig} onChange={setExportConfig} />
                  <div className="batch-export-actions">
                    <Button
                      variant="primary"
                      disabled={batchEnqueuing}
                      onClick={handleExport}
                      type="button"
                      style={{ width: '100%' }}
                    >
                      {batchEnqueuing ? '任务创建中...' : batchExportMode ? `确认导出 (${filePathList?.length ?? 0} 个文件)` : '导出'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </Dialog>
  )
}
