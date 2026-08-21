import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppleLivePhotoExportOption } from './AppleLivePhotoExportOption'
import { buildExportLayers, exportBatchFiles, type BatchExportSource } from './previewStageExport'
import { ExportSettingsPanel, type VideoExportSettings } from './ExportSettingsPanel'
import { HtmlPreview } from './HtmlPreview'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader, type PreviewQuality } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkSettings } from './WatermarkSettings'
import { useFileCache } from '../hooks/useFileCache'
import { canUseLunaUltraWatermark } from '../hooks/useLunaUltraWatermark'
import { filePathToPreviewUrl, isVideoPath } from '../lib/fileUtils'
import { logger } from '../lib/rendererLogger'
import { getIsLivePhoto } from '../shared/livePhoto'
import { DEFAULT_VIDEO_EXPORT_SETTINGS, lockDolbyVisionExportSettings } from '../shared/types'
import type { DolbyVisionProbeResult, LunaFile, PreviewLayer, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { usesCustomWatermark } from '../shared/watermarkGeometry'
import { Button, Dialog, IconButton, toast } from '../ui'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import { findLunaUltraRestoreLut } from '../workspace/lut/lunaUltraRestoreLut'
import { lutManager } from '../workspace/lut/LutManager'
import '../styles/modal.css'

interface PreviewModalProps {
  filePath: string
  filePathList?: string[]
  previewOnly?: boolean
  lightweightPreview?: boolean
  proxyPreviewPaths?: string[]
  batchExportMode?: boolean
  enableILogRestoreOption?: boolean
  onFilePathChange?: (filePath: string) => void
  mediaFileForPath?: (filePath: string) => LunaFile | undefined
  isFileSelected?: (filePath: string) => boolean
  onSetFileSelected?: (filePath: string, selected: boolean) => void
  originalVideoUrls?: Record<string, string>
  onDownload?: (filePath: string) => void
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
  enableILogRestoreOption,
  onFilePathChange,
  mediaFileForPath,
  isFileSelected,
  onSetFileSelected,
  originalVideoUrls,
  onDownload,
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
  const [exportAppleLivePhoto, setExportAppleLivePhoto] = useState(false)
  const [livePhotoCount, setLivePhotoCount] = useState(0)
  const [exportConfig, setExportConfig] = useState<VideoExportSettings>(() => ({
    ...DEFAULT_VIDEO_EXPORT_SETTINGS,
    autoRestoreILog: false,
  }))
  const [dolbyVisionProbe, setDolbyVisionProbe] = useState<DolbyVisionProbeResult | null>(null)
  const [dolbyVisionChecking, setDolbyVisionChecking] = useState(false)
  const [hasILogInExport, setHasILogInExport] = useState(false)
  const [previewQuality, setPreviewQuality] = useState<PreviewQuality>('proxy')
  const previewQualityPreferenceRevision = useRef(0)
  const [immersive, setImmersive] = useState(false)
  const [navigationVisible, setNavigationVisible] = useState(false)
  const navigationHideTimerRef = useRef<number | null>(null)

  const navigationFiles = filePathList?.length ? filePathList : [currentFilePath]
  const currentNavigationIndex = navigationFiles.indexOf(currentFilePath)
  const canNavigatePrevious = currentNavigationIndex > 0
  const canNavigateNext = currentNavigationIndex >= 0 && currentNavigationIndex < navigationFiles.length - 1

  const revealNavigation = useCallback(() => {
    setNavigationVisible(true)
    if (navigationHideTimerRef.current !== null) {
      window.clearTimeout(navigationHideTimerRef.current)
    }
    navigationHideTimerRef.current = window.setTimeout(() => {
      navigationHideTimerRef.current = null
      setNavigationVisible(false)
    }, 1800)
  }, [])

  const hideNavigation = useCallback(() => {
    if (navigationHideTimerRef.current !== null) {
      window.clearTimeout(navigationHideTimerRef.current)
      navigationHideTimerRef.current = null
    }
    setNavigationVisible(false)
  }, [])

  useEffect(() => hideNavigation, [hideNavigation])

  function navigateTo(index: number): void {
    const nextFilePath = navigationFiles[index]
    if (nextFilePath) setCurrentFilePath(nextFilePath)
    revealNavigation()
  }

  const enterImmersive = useCallback(() => {
    setImmersive(true)
    void window.luna.setFullScreen(true).catch(() => setImmersive(false))
  }, [])

  const exitImmersive = useCallback(() => {
    setImmersive(false)
    void window.luna.setFullScreen(false).catch(() => {})
  }, [])

  const toggleImmersive = useCallback(() => {
    if (immersive) exitImmersive()
    else enterImmersive()
  }, [enterImmersive, exitImmersive, immersive])

  useEffect(() => {
    const unsubscribe = window.luna.onFullScreenChange(setImmersive)
    return () => {
      unsubscribe()
      void window.luna.setFullScreen(false)
    }
  }, [])

  const originalVideoUrl = originalVideoUrls?.[currentFilePath] ?? null
  const canUseOriginalPreview = Boolean(originalVideoUrl)
  const useOriginalPreview = canUseOriginalPreview && previewQuality === 'original'
  const selectedSourcePath = useOriginalPreview ? originalVideoUrl : currentFilePath
  const mediaFile = useMemo(
    () => mediaFileForPath?.(currentFilePath),
    [currentFilePath, mediaFileForPath],
  )

  useEffect(() => {
    let cancelled = false
    const revision = previewQualityPreferenceRevision.current
    void window.luna.getSettings()
      .then((settings) => {
        if (cancelled || previewQualityPreferenceRevision.current !== revision) return
        if (settings.cameraPreviewQuality === 'original' || settings.cameraPreviewQuality === 'proxy') {
          setPreviewQuality(settings.cameraPreviewQuality)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const handlePreviewQualityChange = useCallback((quality: PreviewQuality) => {
    previewQualityPreferenceRevision.current += 1
    setPreviewQuality(quality)
    void window.luna.saveSettings({ cameraPreviewQuality: quality }).catch(() => {})
  }, [])

  // 解析远程文件：HTTP URL → 缓存到本地，与 MediaCard 逻辑一致
  const { cacheFilePath: resolvedPath } = useFileCache(useOriginalPreview ? null : currentFilePath)

  const isRemoteSource = isHttpPath(selectedSourcePath)
  const activeSourcePath = useOriginalPreview
    ? originalVideoUrl
    : isRemoteSource
      ? resolvedPath
      : selectedSourcePath
  const displaySource = activeSourcePath
    ? (isHttpPath(activeSourcePath) ? activeSourcePath : filePathToPreviewUrl(activeSourcePath) ?? activeSourcePath)
    : null
  const stageSource = toLocalPath(activeSourcePath)
  const htmlMediaPath = activeSourcePath && isHttpPath(activeSourcePath) ? null : stageSource
  const proxyPreview = proxyPreviewPaths?.includes(currentFilePath) ?? false
  const metadataCachedPath = mediaFile?.downloadFilePath
    ?? mediaFile?.localPath
    ?? (isRemoteSource ? null : stageSource)
  const currentSelected = selectionOverrides.get(currentFilePath) ?? isFileSelected?.(currentFilePath)
  const exportList = useMemo(
    () => batchExportMode ? (filePathList ?? []) : [currentFilePath],
    [batchExportMode, currentFilePath, filePathList],
  )

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

  const dolbyVisionProbePaths = useMemo(() => {
    const candidates = batchExportMode ? exportList : (stageSource ? [stageSource] : [])
    return candidates
      .map((path) => toLocalPath(path))
      .filter((path): path is string => path !== null && isVideoPath(path))
  }, [batchExportMode, exportList, stageSource])

  useEffect(() => {
    if (!enableILogRestoreOption) {
      setHasILogInExport(false)
      setExportConfig((current) => current.autoRestoreILog ? { ...current, autoRestoreILog: false } : current)
      return
    }

    const videoPaths = exportList
      .map((sourcePath) => toLocalPath(sourcePath))
      .filter((sourcePath): sourcePath is string => sourcePath !== null && isVideoPath(sourcePath))

    if (videoPaths.length === 0) {
      setHasILogInExport(false)
      setExportConfig((current) => current.autoRestoreILog ? { ...current, autoRestoreILog: false } : current)
      return
    }

    let cancelled = false
    setHasILogInExport(false)
    setExportConfig((current) => current.autoRestoreILog ? { ...current, autoRestoreILog: false } : current)
    void Promise.all(videoPaths.map((sourcePath) => window.luna.detectILog(sourcePath).catch(() => false)))
      .then((results) => {
        if (cancelled) return
        const hasILog = results.some(Boolean)
        setHasILogInExport(hasILog)
        setExportConfig((current) => current.autoRestoreILog === hasILog
          ? current
          : { ...current, autoRestoreILog: hasILog })
      })

    return () => { cancelled = true }
  }, [enableILogRestoreOption, exportList])

  useEffect(() => {
    if (previewOnly || !window.navigator.platform.includes('Mac')) {
      setLivePhotoCount(0)
      setExportAppleLivePhoto(false)
      return
    }

    let cancelled = false
    void Promise.all(exportList.map((path) => getIsLivePhoto(path))).then((results) => {
      if (cancelled) return
      const count = results.filter(Boolean).length
      setLivePhotoCount(count)
      if (count === 0) setExportAppleLivePhoto(false)
    })
    return () => { cancelled = true }
  }, [exportList, previewOnly])

  useEffect(() => {
    const canProbe = Boolean(lightweightPreview && dolbyVisionProbePaths.length > 0)
    if (!canProbe) {
      setDolbyVisionProbe(null)
      setDolbyVisionChecking(false)
      setExportConfig((current) => current.dolbyVision ? { ...current, dolbyVision: false } : current)
      return
    }
    let cancelled = false
    setDolbyVisionChecking(true)
    setDolbyVisionProbe(null)
    void Promise.all(dolbyVisionProbePaths.map((path) => window.luna.workspace.probeDolbyVision(path)))
      .then((results) => {
        if (cancelled) return
        const result = results.find((probe) => !probe.eligible) ?? results[0]
        const allEligible = results.length > 0 && results.every((probe) => probe.eligible)
        setDolbyVisionProbe(allEligible ? results[0] : { ...result, eligible: false })
        setExportConfig((current) => allEligible
          ? lockDolbyVisionExportSettings(current)
          : current.dolbyVision ? { ...current, dolbyVision: false } : current)
      })
      .catch(() => {
        if (!cancelled) {
          setDolbyVisionProbe(null)
          setExportConfig((current) => current.dolbyVision ? { ...current, dolbyVision: false } : current)
        }
      })
      .finally(() => { if (!cancelled) setDolbyVisionChecking(false) })
    return () => { cancelled = true }
  }, [dolbyVisionProbePaths, lightweightPreview])

  useEffect(() => {
    setWatermarkLayers([])
  }, [currentFilePath, displaySource, resolvedPath, stageSource])

  useEffect(() => {
    if (!watermarkSettings) return
    const timer = window.setTimeout(() => {
      void window.luna.saveSettings({ recentWatermarkSettings: watermarkSettings }).catch(() => {})
    }, 250)
    return () => window.clearTimeout(timer)
  }, [watermarkSettings])

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

      const restoreByPath = new Map<string, boolean>()
      if (exportConfig.autoRestoreILog) {
        await Promise.all(exportList.map(async (sourcePath) => {
          if (isVideoPath(sourcePath)) restoreByPath.set(sourcePath, await window.luna.detectILog(sourcePath))
        }))
      }
      let restoreLutPath: string | null = null
      if ([...restoreByPath.values()].some(Boolean)) {
        restoreLutPath = findLunaUltraRestoreLut(await lutManager.discoverLuts())?.filePath ?? null
        if (!restoreLutPath) throw new Error('未找到 I-Log 还原资源，请稍后重试')
      }

      const sources: BatchExportSource[] = await Promise.all(exportList.map(async (sourcePath) => {
        const resolution = await window.luna.workspace.getMediaResolution(sourcePath)
        const restoreILog = restoreByPath.get(sourcePath) === true
        const canUseBuiltinWatermark = await canUseLunaUltraWatermark(
          sourcePath,
          isVideoPath(sourcePath) ? 'video' : 'image',
        )
        const layers = buildExportLayers(
          sourcePath,
          resolution,
          usesCustomWatermark(watermarkSettings) || canUseBuiltinWatermark ? watermarkSettings : null,
        )
        if (restoreILog && layers[0] && restoreLutPath) layers[0] = { ...layers[0], restoreLutId: restoreLutPath }
        return {
          sourcePath,
          layers,
          passthrough: layers.length === 1 && !restoreILog,
        }
      }))

      await exportBatchFiles(
        sources,
        settings.exportDir,
        hasVideoInBatch ? exportConfig : null,
        { appleLivePhoto: exportAppleLivePhoto },
      )
      toast.success(`已加入导出队列 (${sources.length} 个文件)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setBatchEnqueuing(false)
    }
  }, [batchEnqueuing, exportAppleLivePhoto, exportConfig, exportList, hasVideoInBatch, watermarkSettings])

  // Escape 关闭
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      if (immersive) exitImmersive()
      else onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [exitImmersive, immersive, onClose])

  return (
    <Dialog open variant="fullscreen" closeOnMaskClick={false} onOpenChange={(o) => !o && onClose()}>
      <section className={`preview-modal${immersive ? ' is-immersive' : ''}`}>
        <PreviewModalHeader
          filePath={currentFilePath}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          previewQuality={previewQuality}
          onPreviewQualityChange={handlePreviewQualityChange}
          showOriginalOption={canUseOriginalPreview}
          selected={currentSelected}
          onToggleSelected={onSetFileSelected && currentSelected !== undefined ? () => {
            const nextSelected = !currentSelected
            setSelectionOverrides((current) => new Map(current).set(currentFilePath, nextSelected))
            onSetFileSelected(currentFilePath, nextSelected)
          } : undefined}
          onDownload={onDownload ? () => onDownload(currentFilePath) : undefined}
          onClose={onClose}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            <div
              className={`preview-stage-shell${navigationVisible ? ' navigation-visible' : ''}`}
              onMouseMove={revealNavigation}
              onMouseLeave={hideNavigation}
            >
              <IconButton
                variant="light"
                className={`preview-immersive-toggle${navigationVisible ? ' is-visible' : ''}`}
                icon={immersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                onClick={toggleImmersive}
                title={immersive ? '退出全屏' : '全屏预览'}
                aria-label={immersive ? '退出全屏' : '全屏预览'}
                aria-pressed={immersive}
              />
              {previewOnly || lightweightPreview ? (
                <div className="preview-stage">
                  <HtmlPreview
                    url={displaySource}
                    mediaPath={htmlMediaPath}
                    proxyPreview={proxyPreview && !useOriginalPreview}
                    watermarkLayer={lightweightPreview ? watermarkLayers[0] : undefined}
                    watermarkSettings={lightweightPreview ? watermarkSettings : undefined}
                    watermarkEditable={Boolean(lightweightPreview && !previewOnly && watermarkSettings?.enabled && watermarkSettings.sourceKind === 'custom')}
                    onWatermarkChange={lightweightPreview ? handleWatermarkChange : undefined}
                  />
                </div>
              ) : (
                <PreviewStage
                  url={stageSource}
                  extraLayers={watermarkLayers}
                />
              )}

              {navigationFiles.length > 1 && (
                <>
                  <IconButton
                    variant="light"
                    className={`preview-nav previous${navigationVisible ? ' is-visible' : ''}`}
                    icon={<ChevronLeft size={21} />}
                    disabled={!canNavigatePrevious}
                    onClick={() => navigateTo(currentNavigationIndex - 1)}
                    title="上一张"
                    aria-label="上一张"
                  />
                  <IconButton
                    variant="light"
                    className={`preview-nav next${navigationVisible ? ' is-visible' : ''}`}
                    icon={<ChevronRight size={21} />}
                    disabled={!canNavigateNext}
                    onClick={() => navigateTo(currentNavigationIndex + 1)}
                    title="下一张"
                    aria-label="下一张"
                  />
                </>
              )}
            </div>

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
                file={mediaFile}
                cachedPath={metadataCachedPath}
                proxyPreview={proxyPreview && !useOriginalPreview}
                onToggleCollapse={() => setInspectorOpen(false)}
                header={!previewOnly && stageSource ? (
                  <WatermarkSettings
                    settings={watermarkSettings ?? undefined}
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
                      showILogRestore={hasILogInExport}
                    />
                  )}
                  <div className="batch-export-actions">
                    <AppleLivePhotoExportOption
                      checked={exportAppleLivePhoto}
                      livePhotoCount={livePhotoCount}
                      batch={Boolean(batchExportMode)}
                      onCheckedChange={setExportAppleLivePhoto}
                    />
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
