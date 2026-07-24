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
import { canUseLunaUltraWatermark, useLunaUltraWatermark } from '../hooks/useLunaUltraWatermark'
import { filePathToPreviewUrl, isVideoPath } from '../lib/fileUtils'
import { logger } from '../lib/rendererLogger'
import { DEFAULT_VIDEO_EXPORT_SETTINGS } from '../shared/types'
import type { DolbyVisionProbeResult, PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { Button, Dialog, toast } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  filePath: string
  filePathList?: string[]
  previewOnly?: boolean
  lightweightPreview?: boolean
  proxyPreviewPaths?: string[]
  batchExportMode?: boolean
  onFilePathChange?: (filePath: string) => void
  isFileSelected?: (filePath: string) => boolean
  onSetFileSelected?: (filePath: string, selected: boolean) => void
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
  lightweightPreview,
  proxyPreviewPaths,
  batchExportMode,
  onFilePathChange,
  isFileSelected,
  onSetFileSelected,
  onClose,
}: PreviewModalProps) {
  // ── 当前预览文件路径 ──
  const [currentFilePath, setCurrentFilePath] = useState(filePath)
  const [selectionOverrides, setSelectionOverrides] = useState<Map<string, boolean>>(new Map())

  // 外部 filePath 变化时重置
  useEffect(() => {
    setCurrentFilePath(filePath)
    setSelectionOverrides(new Map())
  }, [filePath])

  useEffect(() => {
    onFilePathChange?.(currentFilePath)
  }, [currentFilePath, onFilePathChange])

  // ── 状态 ──
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkLayers, setWatermarkLayers] = useState<PreviewLayer[]>([])
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType | null>(null)
  const [batchEnqueuing, setBatchEnqueuing] = useState(false)
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS)
  const [dolbyVisionProbe, setDolbyVisionProbe] = useState<DolbyVisionProbeResult | null>(null)
  const [dolbyVisionChecking, setDolbyVisionChecking] = useState(false)

  // 解析远程文件：HTTP URL → 缓存到本地，与 MediaCard 逻辑一致
  const { cacheFilePath: resolvedPath } = useFileCache(currentFilePath)

  const isRemoteSource = isHttpPath(currentFilePath)
  const activeSourcePath = isRemoteSource ? resolvedPath : currentFilePath
  const displaySource = activeSourcePath ? (filePathToPreviewUrl(activeSourcePath) ?? activeSourcePath) : null
  const stageSource = toLocalPath(activeSourcePath)
  const proxyPreview = proxyPreviewPaths?.includes(currentFilePath) ?? false
  const currentSelected = selectionOverrides.get(currentFilePath) ?? isFileSelected?.(currentFilePath)
  const allowWatermark = useLunaUltraWatermark(stageSource ? {
    path: stageSource,
    kind: isVideoPath(stageSource) ? 'video' : 'image',
  } : null)

  useEffect(() => {
    logger.info('[预览诊断] 预览窗口打开', {
      filePath: currentFilePath,
      isRemoteSource,
      isVideo: isVideoPath(currentFilePath),
      previewOnly: Boolean(previewOnly),
    })
  }, [currentFilePath, isRemoteSource, previewOnly])

  useEffect(() => {
    if (!activeSourcePath) return
    logger.info('[预览诊断] 预览资源已就绪', {
      filePath: activeSourcePath,
      isRemoteSource,
    })
  }, [activeSourcePath, isRemoteSource])

  // 批量导出时，检查整个列表是否包含视频；非批量时仅检查当前文件
  const hasVideoInBatch = batchExportMode
    ? (filePathList ?? []).some((fp) => isVideoPath(fp))
    : isVideoPath(currentFilePath)

  useEffect(() => {
    const canProbe = Boolean(lightweightPreview && !batchExportMode && stageSource && isVideoPath(stageSource))
    if (!canProbe) {
      setDolbyVisionProbe(null)
      setDolbyVisionChecking(false)
      setExportConfig((current) => current.dolbyVision ? { ...current, dolbyVision: false } : current)
      return
    }
    let cancelled = false
    setDolbyVisionChecking(true)
    setDolbyVisionProbe(null)
    window.luna.workspace.probeDolbyVision(stageSource!)
      .then((result) => {
        if (cancelled) return
        setDolbyVisionProbe(result)
        if (!result.eligible) {
          setExportConfig((current) => current.dolbyVision ? { ...current, dolbyVision: false } : current)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDolbyVisionProbe(null)
          setExportConfig((current) => current.dolbyVision ? { ...current, dolbyVision: false } : current)
        }
      })
      .finally(() => { if (!cancelled) setDolbyVisionChecking(false) })
    return () => { cancelled = true }
  }, [batchExportMode, lightweightPreview, stageSource])

  useEffect(() => {
    setWatermarkLayers([])
  }, [currentFilePath, displaySource, resolvedPath, stageSource])

  useEffect(() => {
    if (!allowWatermark) setWatermarkLayers([])
  }, [allowWatermark])

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
      if (exportConfig.dolbyVision && watermarkLayers.length !== 1) {
        toast.error('Dolby Vision 导出需要先开启水印')
        return
      }

      const exportList = batchExportMode ? (filePathList ?? []) : [currentFilePath]
      const sources: BatchExportSource[] = await Promise.all(exportList.map(async (sourcePath) => {
        const resolution = await window.luna.workspace.getMediaResolution(sourcePath)
        const canUseWatermark = await canUseLunaUltraWatermark(
          sourcePath,
          isVideoPath(sourcePath) ? 'video' : 'image',
        )
        return {
          sourcePath,
          layers: buildExportLayers(sourcePath, resolution, canUseWatermark ? watermarkSettings : null),
        }
      }))

      await exportBatchFiles(sources, settings.exportDir, hasVideoInBatch ? exportConfig : null)
      toast.success(`已加入导出队列 (${sources.length} 个文件)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchEnqueuing(false)
    }
  }, [batchEnqueuing, batchExportMode, exportConfig, filePathList, currentFilePath, hasVideoInBatch, watermarkLayers.length, watermarkSettings])

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
          selected={currentSelected}
          onToggleSelected={onSetFileSelected && currentSelected !== undefined ? () => {
            const nextSelected = !currentSelected
            setSelectionOverrides((current) => new Map(current).set(currentFilePath, nextSelected))
            onSetFileSelected(currentFilePath, nextSelected)
          } : undefined}
          onClose={onClose}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            {previewOnly || lightweightPreview ? (
              <div className="preview-stage">
                <HtmlPreview
                  url={displaySource}
                  mediaPath={stageSource}
                  proxyPreview={proxyPreview}
                  watermarkLayer={lightweightPreview ? watermarkLayers[0] : undefined}
                />
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
                proxyPreview={proxyPreview}
                onToggleCollapse={() => setInspectorOpen(false)}
                header={!previewOnly && allowWatermark ? (
                  <WatermarkSettings
                    onChange={handleWatermarkChange}
                    filePath={stageSource ?? undefined}
                    mediaKind={isVideoPath(currentFilePath) ? 'video' : 'image'}
                  />
                ) : undefined}
              />
              {!previewOnly && (
                <>
                  {hasVideoInBatch && (
                    <ExportSettingsPanel
                      value={exportConfig}
                      onChange={setExportConfig}
                      dolbyVisionAvailable={dolbyVisionProbe?.eligible}
                      dolbyVisionChecking={dolbyVisionChecking}
                    />
                  )}
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
