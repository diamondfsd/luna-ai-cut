import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { buildHistogram, emptyDetails, filePathToLunaFile, filePathToPreviewUrl, type MediaDetails, thumbnailForPath } from './previewModalUtils'
import type { DownloadProgress, LunaFile, MediaMetadata, PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { watermarkStyleOptionsForDevice } from '../shared/watermarkAssets'
import { Dialog } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  /** 文件路径 — 必须，组件从路径推导所有文件信息 */
  filePath: string
  /** 可选文件列表，用于缩略图导航 */
  files?: LunaFile[]
  /** 当前文件（当 files 传入时需要） */
  currentFile?: LunaFile
  onFileChange?: (file: LunaFile) => void

  onClose: () => void
  onReveal?: (file: LunaFile) => void
  onDownload?: (file: LunaFile) => void
  onExportWithWatermark?: (file: LunaFile, settings: WatermarkSettingsType) => void
  autoPlayLive?: boolean

  /** @deprecated 逐渐淘汰 */
  preview?: PreviewResult | null
  previewLoading?: boolean
  downloadProgress?: DownloadProgress
  isDownloadsPage?: boolean
  showWatermarkControls?: boolean
}

export function PreviewModal({
  filePath,
  files: propFiles,
  currentFile: propCurrentFile,
  onFileChange,
  onClose,
  onReveal,
  onDownload,
  onExportWithWatermark,
  autoPlayLive = false,
  preview: deprecatedPreview,
  previewLoading: deprecatedPreviewLoading,
  downloadProgress,
  isDownloadsPage = false,
  showWatermarkControls: propShowWatermarkControls,
}: PreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const thumbStripRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)

  // ── 从文件路径推导文件信息 ──
  const internalFile = useMemo(() => filePathToLunaFile(filePath, {
    thumbnailUrl: thumbnailForPath(filePath),
  }), [filePath])
  const file = propCurrentFile ?? internalFile
  const showWatermarkControls = propShowWatermarkControls ?? isDownloadsPage

  // ── 导航 ──
  const modalFiles = useMemo(() => {
    if (propFiles && propFiles.some((item) => item.id === file.id)) return propFiles
    if (propFiles) return [...propFiles, file]
    return [file]
  }, [file, propFiles])

  const [hasPrevious, hasNext] = useMemo(() => {
    const idx = modalFiles.findIndex((f) => f.id === file.id)
    return [idx > 0, idx >= 0 && idx < modalFiles.length - 1]
  }, [modalFiles, file.id])

  function navigateFile(direction: -1 | 1): void {
    const idx = modalFiles.findIndex((f) => f.id === file.id)
    if (idx < 0) return
    const next = idx + direction
    if (next < 0 || next >= modalFiles.length) return
    onFileChange?.(modalFiles[next])
  }

  // ── 预览加载 ──
  const [internalPreview, setInternalPreview] = useState<PreviewResult | null>(null)
  const [internalPreviewLoading, setInternalPreviewLoading] = useState(false)

  const preview = deprecatedPreview ?? internalPreview
  const previewLoading = deprecatedPreviewLoading ?? internalPreviewLoading

  // 内部自动加载预览
  useEffect(() => {
    if (deprecatedPreview !== undefined) return // 外部提供了就用外部的
    setInternalPreviewLoading(true)
    window.luna.previewFile(file, modalFiles)
      .then(setInternalPreview)
      .catch(() => {})
      .finally(() => setInternalPreviewLoading(false))
  }, [file.id])

  // ── 状态 ──
  const [mediaDetails, setMediaDetails] = useState<MediaDetails>(() => emptyDetails())
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
  const [baseScale, setBaseScale] = useState(1)
  const [imageDragging, setImageDragging] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  // 获取设备默认水印样式
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>(() => ({
    enabled: false,
    style: 'luna_ultra',
    position: 'bottom-center',
  }))
  const [livePreview, setLivePreview] = useState<PreviewResult | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [livePlaying, setLivePlaying] = useState(false)
  const [liveReplayKey, setLiveReplayKey] = useState(0)
  const [liveError, setLiveError] = useState<string | null>(null)
  const liveSource = livePreview?.source ?? null
  const autoPlayLiveRef = useRef<string | null>(null)
  const imageDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)

  const completedDownloadPath = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists'
    ? downloadProgress.destinationPath ?? null
    : null
  const isDownloadingCurrentFile = downloadProgress?.status === 'queued' || downloadProgress?.status === 'downloading'
  const downloadedPath = file.downloadFilePath ?? file.localPath ?? completedDownloadPath
  const isDownloaded = !!downloadedPath
  const effectiveWatermark = showWatermarkControls && isDownloaded
  const previewMatchesFile = preview?.fileName === file.name
  const displaySource = downloadedPath ? filePathToPreviewUrl(downloadedPath) : previewMatchesFile ? preview?.source ?? null : null
  const progressPercent = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists' ? 100 : downloadProgress?.percent ?? 0

  // 加载已保存的水印设置，若无保存则设设备默认样式
  useEffect(() => {
    if (!isDownloadsPage) return
    const deviceIdForWm = file.sourceDeviceId ?? file.watermarkProfileId ?? null
    window.luna.getSettings().then((s) => {
      const activeId = s.activeDeviceId
      const wm = activeId ? s.deviceWatermark?.[activeId] : undefined
      if (wm) {
        setWatermarkSettings(wm)
      } else if (deviceIdForWm) {
        const opts = watermarkStyleOptionsForDevice(deviceIdForWm)
        if (opts.length > 0) {
          setWatermarkSettings((prev) => ({ ...prev, style: opts[0].value }))
        }
      }
    }).catch(() => {})
  }, [isDownloadsPage, file.sourceDeviceId, file.watermarkProfileId])

  function saveWatermarkSettings(next: WatermarkSettingsType): void {
    setWatermarkSettings(next)
    window.luna.getSettings().then((s) => {
      const deviceId = s.activeDeviceId
      if (deviceId) {
        window.luna.saveSettings({
          deviceWatermark: { ...s.deviceWatermark, [deviceId]: next },
        }).catch(() => {})
      }
    }).catch(() => {})
  }

  useEffect(() => {
    setLivePreview(null)
    setLiveLoading(false)
    setLivePlaying(false)
    setLiveReplayKey(0)
    setLiveError(null)
    autoPlayLiveRef.current = null
  }, [file.id])

  useEffect(() => {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
    setBaseScale(1)
    setImageDragging(false)
  }, [file.id])

  // 从元数据回填文件信息
  const enrichedFile = useMemo(() => {
    if (!mediaMetadata) return file
    const map = new Map<string, string>()
    for (const group of mediaMetadata.groups) {
      for (const entry of group.entries) map.set(entry.key, entry.value)
    }
    let bytes = file.bytes
    let capturedAt = file.capturedAt
    if (bytes === null || bytes === undefined) {
      const fileSizeStr = map.get('size')
      if (fileSizeStr) {
        const num = Number(fileSizeStr)
        if (!Number.isNaN(num)) bytes = Math.round(num)
      }
    }
    if (!capturedAt) {
      capturedAt = map.get('DateTimeOriginal') ?? map.get('CreateDate') ?? map.get('ModifyDate') ?? null
    }
    if (bytes === file.bytes && capturedAt === file.capturedAt) return file
    return { ...file, bytes, capturedAt }
  }, [file, mediaMetadata])

  // 元数据懒加载 — inspector 打开时才加载
  useEffect(() => {
    if (!inspectorOpen || file.kind === 'unknown') {
      setMediaMetadata(null)
      return
    }
    if (file.kind === 'image') {
      const metaPath = downloadedPath
      if (!metaPath) return
      setMetadataLoading(true)
      window.luna.getMediaMetadata(file, metaPath)
        .then(setMediaMetadata)
        .catch(() => setMediaMetadata({ groups: [] }))
        .finally(() => setMetadataLoading(false))
      return
    }
    if (file.kind === 'video' && isDownloaded) {
      setMetadataLoading(true)
      window.luna.getMediaMetadata(file, downloadedPath)
        .then((meta) => {
          setMediaMetadata(meta)
          const videoGroup = meta.groups.find((g) => g.name === '视频')
          const fpsEntry = videoGroup?.entries.find((e) => e.key === '帧率')
          if (fpsEntry) {
            const fps = Number.parseFloat(fpsEntry.value)
            if (!Number.isNaN(fps)) setMediaDetails((prev) => ({ ...prev, frameRate: fps }))
          }
        })
        .catch(() => {})
        .finally(() => setMetadataLoading(false))
    }
  }, [inspectorOpen, file.id, file.kind, isDownloaded, downloadedPath])

  const handleImageLoaded = useCallback((image: HTMLImageElement) => {
    let histogram: MediaDetails['histogram'] = []
    try { histogram = buildHistogram(image) } catch { histogram = [] }
    setMediaDetails((current) => ({ ...current, width: image.naturalWidth, height: image.naturalHeight, histogram }))
  }, [])

  const handleVideoLoaded = useCallback((video: HTMLVideoElement) => {
    setMediaDetails((current) => ({
      ...current,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    }))
  }, [])

  const handleVideoTimeUpdate = useCallback((video: HTMLVideoElement) => {
    setMediaDetails((current) => ({ ...current, currentTime: video.currentTime }))
  }, [])

  // 水印加载相关
  const playLivePhoto = useCallback(async () => {
    if (liveLoading) return
    setLiveLoading(true)
    setLiveError(null)
    try {
      const result = livePreview ?? await window.luna.previewLivePhoto(file)
      setLivePreview(result)
      setLivePlaying(true)
    } catch (e: any) {
      setLiveError(e?.message ?? 'Live Photo 加载失败')
    } finally {
      setLiveLoading(false)
      setLiveReplayKey((k) => k + 1)
    }
  }, [liveLoading, livePreview, file])

  useEffect(() => {
    if (!autoPlayLive || previewLoading || autoPlayLiveRef.current === file.id) return
    autoPlayLiveRef.current = file.id
    const timer = setTimeout(() => void playLivePhoto(), 200)
    return () => clearTimeout(timer)
  }, [autoPlayLive, file.id, previewLoading, playLivePhoto])

  // 手势相关
  function handleImagePointerDown(event: ReactPointerEvent): void {
    if (imageZoom <= 1) return
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imagePan.x,
      originY: imagePan.y,
    }
  }

  function handleImagePointerMove(event: ReactPointerEvent): void {
    const drag = imageDragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    setImagePan({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    })
  }

  function finishImageDrag(): void { imageDragRef.current = null }

  function handleImageDoubleClick(_event: React.MouseEvent): void {
    setImageZoom((current) => current > 1 ? 1 : 3)
    setImagePan({ x: 0, y: 0 })
  }

  useEffect(() => {
    function handleWheel(event: WheelEvent): void {
      const target = event.target as HTMLElement | null
      const inPreviewModal = Boolean(target?.closest('.preview-modal'))
      if (!inPreviewModal || target?.closest('.media-inspector') || target?.closest('.preview-thumbnails')) return
      event.preventDefault()
      setImageZoom((current) => {
        const next = Math.min(8, Math.max(1, current + (event.deltaY < 0 ? 0.18 : -0.18)))
        if (next <= 1) setImagePan({ x: 0, y: 0 })
        return next
      })
    }
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => document.removeEventListener('wheel', handleWheel, { capture: true })
  }, [file.kind])

  // 键盘导航
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowUp') && hasPrevious) navigateFile(-1)
      if ((event.key === 'ArrowRight' || event.key === 'ArrowDown') && hasNext) navigateFile(1)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalFiles, file.id, onFileChange, onClose])

  return (
    <Dialog open variant="fullscreen" onOpenChange={(o) => !o && onClose()}>
      <section className="preview-modal">
        <PreviewModalHeader
          downloadProgress={downloadProgress}
          file={enrichedFile}
          inspectorOpen={inspectorOpen}
          isDownloaded={isDownloaded}
          isDownloadingCurrentFile={isDownloadingCurrentFile}
          isDownloadsPage={isDownloadsPage}
          progressPercent={progressPercent}
          showWatermarkControls={effectiveWatermark}
          watermarkSettings={watermarkSettings}
          onClose={onClose}
          onDownload={onDownload}
          onExportWithWatermark={onExportWithWatermark}
          onReveal={onReveal}
          onSetInspectorOpen={setInspectorOpen}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            <PreviewStage
              displaySource={displaySource}
              file={enrichedFile}
              hasNext={hasNext}
              hasPrevious={hasPrevious}
              imageDragging={imageDragging}
              imagePan={imagePan}
              imageZoom={imageZoom}
              liveError={liveError}
              liveLoading={liveLoading}
              livePlaying={livePlaying}
              livePreviewMessage={undefined}
              liveReplayKey={liveReplayKey}
              liveSource={liveSource}
              previewFileName={preview?.fileName}
              previewLoading={previewLoading}
              previewMessage={preview?.message}
              previewImageRef={previewImageRef}
              showWatermarkControls={effectiveWatermark}
              videoRef={videoRef}
              watermarkSettings={watermarkSettings}
              finishImageDrag={finishImageDrag}
              handleImageDoubleClick={handleImageDoubleClick}
              handleImageLoaded={handleImageLoaded}
              handleImagePointerDown={handleImagePointerDown}
              handleImagePointerMove={handleImagePointerMove}
              handleVideoLoaded={handleVideoLoaded}
              handleVideoTimeUpdate={handleVideoTimeUpdate}
              navigateFile={navigateFile}
              playLivePhoto={playLivePhoto}
              setLiveError={setLiveError}
            />

            <PreviewThumbnailStrip
              activeThumbRef={activeThumbRef}
              currentFileId={file.id}
              files={modalFiles}
              stripRef={thumbStripRef}
              onFileChange={(f) => onFileChange?.(f)}
            />
          </div>

          {inspectorOpen && (
            <MediaInspector
              file={enrichedFile}
              mediaDetails={mediaDetails}
              mediaMetadata={mediaMetadata}
              metadataLoading={metadataLoading}
              isDownloaded={isDownloaded}
              imageZoom={imageZoom}
              baseScale={baseScale}
              onZoomIn={() => setImageZoom((z) => Math.min(8, z * 1.5))}
              onZoomOut={() => {
                setImageZoom((z) => {
                  const next = z / 1.5
                  if (next <= 1) { setImagePan({ x: 0, y: 0 }); return 1 }
                  return next
                })
              }}
              onResetZoom={() => { setImageZoom(1); setImagePan({ x: 0, y: 0 }) }}
              onToggleCollapse={() => setInspectorOpen(false)}
              watermarkSettings={effectiveWatermark ? watermarkSettings : undefined}
              onWatermarkChange={effectiveWatermark ? saveWatermarkSettings : undefined}
              watermarkFilePath={effectiveWatermark ? downloadedPath : undefined}
            />
          )}
        </div>
      </section>
    </Dialog>
  )
}
