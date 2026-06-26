import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { buildHistogram, emptyDetails, filePathToPreviewUrl, type MediaDetails } from './previewModalUtils'
import type { DownloadProgress, LunaFile, MediaMetadata, PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { BaseModal } from '../ui'
import '../styles/modal.css'

interface PreviewModalProps {
  files: LunaFile[]
  currentFile: LunaFile
  currentFileId: string
  preview: PreviewResult | null
  previewLoading: boolean
  downloadProgress: DownloadProgress | undefined
  isDownloadsPage: boolean
  showWatermarkControls?: boolean
  onClose: () => void
  onDownload: (file: LunaFile) => void
  onExportWithWatermark?: (file: LunaFile, settings: WatermarkSettingsType) => void
  onReveal: (file: LunaFile) => void
  onFileChange: (file: LunaFile) => void
  autoPlayLive?: boolean
}

export function PreviewModal({
  files,
  currentFile,
  currentFileId,
  preview,
  previewLoading,
  downloadProgress,
  isDownloadsPage,
  showWatermarkControls = isDownloadsPage,
  onClose,
  onDownload,
  onExportWithWatermark,
  onReveal,
  onFileChange,
  autoPlayLive = false,
}: PreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const thumbStripRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)

  const modalFiles = useMemo(() => {
    if (files.some((item) => item.id === currentFile.id)) return files
    return [...files, currentFile]
  }, [currentFile, files])

  const file = useMemo(
    () => modalFiles.find((f) => f.id === currentFileId) ?? currentFile,
    [currentFile, currentFileId, modalFiles],
  )

  const [mediaDetails, setMediaDetails] = useState<MediaDetails>(() => emptyDetails())
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(null)
  const [metadataLoading, setMetadataLoading] = useState(false)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePan, setImagePan] = useState({ x: 0, y: 0 })
  const [baseScale, setBaseScale] = useState(1) // 原始/预览缩放比（displayedNatural）
  const [imageDragging, setImageDragging] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkSettings, setWatermarkSettings] = useState<WatermarkSettingsType>(() => ({
    enabled: false,
    style: 'luna_ultra_cn',
    watermarkPercent: 20,
    position: 'bottom-center',
  }))

  // 加载已保存的水印设置（仅已下载页面需要预览水印）
  useEffect(() => {
    if (!isDownloadsPage) return
    window.luna.getSettings().then((s) => {
      const deviceId = s.activeDeviceId
      const wm = deviceId ? s.deviceWatermark?.[deviceId] : undefined
      if (wm) setWatermarkSettings(wm)
    }).catch(() => {})
  }, [isDownloadsPage])

  const completedDownloadPath = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists'
    ? downloadProgress.destinationPath ?? null
    : null
  const isDownloadingCurrentFile = downloadProgress?.status === 'queued' || downloadProgress?.status === 'downloading'

  // 优先使用已下载的本地文件作为预览源
  const downloadedPath = file.downloadFilePath ?? file.localPath ?? completedDownloadPath
  const previewMatchesFile = preview?.fileName === file.name
  const displaySource = downloadedPath ? filePathToPreviewUrl(downloadedPath) : previewMatchesFile ? preview?.source ?? null : null
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

  // Navigation helpers
  const [hasPrevious, hasNext] = useMemo(() => {
    const idx = modalFiles.findIndex((f) => f.id === currentFileId)
    return [idx > 0, idx >= 0 && idx < modalFiles.length - 1]
  }, [modalFiles, currentFileId])

  function navigateFile(direction: -1 | 1): void {
    const idx = modalFiles.findIndex((f) => f.id === currentFileId)
    if (idx < 0) return
    const next = idx + direction
    if (next < 0 || next >= modalFiles.length) return
    onFileChange(modalFiles[next])
  }

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

  // Wheel zoom for images（含 Live Photo）
  useEffect(() => {
    if (file.kind !== 'image') return

    function handleWheel(event: WheelEvent): void {
      const target = event.target instanceof HTMLElement ? event.target : null
      const inPreviewModal = Boolean(target?.closest('.preview-modal'))
      if (!inPreviewModal || target?.closest('.media-inspector') || target?.closest('.preview-thumbnails')) return

      event.preventDefault()
      event.stopPropagation()

      setImageZoom((current) => {
        const next = Math.min(8, Math.max(1, current + (event.deltaY < 0 ? 0.18 : -0.18)))
        if (next <= 1) setImagePan({ x: 0, y: 0 })
        return next
      })
    }

    document.addEventListener('wheel', handleWheel, { capture: true, passive: false })
    return () => document.removeEventListener('wheel', handleWheel, { capture: true })
  }, [file.kind])

  const isDownloaded = !!downloadedPath
  // 水印控制：仅在已下载文件上生效
  const effectiveWatermark = showWatermarkControls && isDownloaded

  // Load metadata when preview is ready (images) or after download (videos)
  useEffect(() => {
    if (file.kind === 'image') {
      if (!preview?.cachedPath) return
      setMetadataLoading(true)
      window.luna
        .getMediaMetadata(file, preview.cachedPath)
        .then(setMediaMetadata)
        .catch(() => setMediaMetadata({ groups: [] }))
        .finally(() => setMetadataLoading(false))
      return
    }

    // 视频：下载后才获取元数据（分辨率、帧率等）
    if (file.kind === 'video' && isDownloaded) {
      const localPath = file.downloadFilePath ?? file.localPath ?? completedDownloadPath
      setMetadataLoading(true)
      window.luna
        .getMediaMetadata(file, localPath)
        .then((meta) => {
          setMediaMetadata(meta)
          const videoGroup = meta.groups.find((g) => g.name === '视频')
          const fpsEntry = videoGroup?.entries.find((e) => e.key === '帧率')
          if (fpsEntry) {
            const fps = Number.parseFloat(fpsEntry.value)
            if (!Number.isNaN(fps)) {
              setMediaDetails((prev) => ({ ...prev, frameRate: fps }))
            }
          }
        })
        .catch(() => { /* 静默失败 */ })
        .finally(() => setMetadataLoading(false))
    }
  }, [preview?.cachedPath, file, isDownloaded])

  const progressPercent = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists' ? 100 : downloadProgress?.percent ?? 0

  function handleImageLoaded(image: HTMLImageElement): void {
    let histogram: MediaDetails['histogram'] = []
    try {
      histogram = buildHistogram(image)
    } catch {
      histogram = []
    }
    // 计算实际显示比例（CSS 显示尺寸 / 原始像素尺寸）
    const rect = image.getBoundingClientRect()
    const scale = Math.min(
      rect.width / Math.max(image.naturalWidth, 1),
      rect.height / Math.max(image.naturalHeight, 1),
    )
    setBaseScale(Math.max(0.01, scale))
    setMediaDetails((current) => ({ ...current, width: image.naturalWidth, height: image.naturalHeight, histogram }))
  }

  function handleVideoLoaded(video: HTMLVideoElement): void {
    setMediaDetails((current) => ({
      ...current,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
      currentTime: video.currentTime,
    }))
  }

  function handleVideoTimeUpdate(video: HTMLVideoElement): void {
    setMediaDetails((current) => ({
      ...current,
      currentTime: video.currentTime,
      duration: video.duration || current.duration,
    }))
  }

  const playLivePhoto = useCallback(async (): Promise<void> => {
    if (!file.isLivePhoto || liveLoading) return
    setLiveLoading(true)
    setLiveError(null)
    try {
      const result = livePreview ?? await window.luna.previewLivePhoto(file)
      setLivePreview(result)
      setLivePlaying(Boolean(result.source))
      if (result.source) setLiveReplayKey((current) => current + 1)
      if (!result.source && result.message) setLiveError(result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setLivePreview({
        fileName: file.name,
        kind: 'video',
        source: null,
        cachedPath: null,
        message,
      })
      setLiveError(message)
      setLivePlaying(false)
    } finally {
      setLiveLoading(false)
    }
  }, [file, liveLoading, livePreview])

  useEffect(() => {
    if (!autoPlayLive || previewLoading || autoPlayLiveRef.current === file.id) return
    autoPlayLiveRef.current = file.id
    void playLivePhoto()
  }, [autoPlayLive, file.id, playLivePhoto, previewLoading])

  function isZoomedIn(): boolean {
    return imageZoom > 1
  }

  function resetImageView(): void {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
  }

  const handleZoomIn = useCallback(() => {
    setImageZoom((value) => Math.min(8, value + 0.2))
  }, [])

  const handleZoomOut = useCallback(() => {
    setImageZoom((value) => {
      const next = Math.max(1, value - 0.2)
      if (next <= 1) setImagePan({ x: 0, y: 0 })
      return next
    })
  }, [])

  const handleResetZoom = useCallback(() => {
    resetImageView()
  }, [])

  function handleImageDoubleClick(event: ReactPointerEvent<HTMLImageElement>): void {
    event.preventDefault()
    event.stopPropagation()
    if (isZoomedIn()) {
      // 双击已放大的图片，重置为适配屏幕
      resetImageView()
      return
    }
    // 双击未放大的图片，设为 100%（原始像素 1:1）
    setImageZoom(Math.round((1 / baseScale) * 100) / 100)
    setImagePan({ x: 0, y: 0 })
  }

  function handleImagePointerDown(event: ReactPointerEvent<HTMLImageElement>): void {
    if (imageZoom <= 1) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    imageDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: imagePan.x,
      originY: imagePan.y,
    }
    setImageDragging(true)
  }

  function handleImagePointerMove(event: ReactPointerEvent<HTMLImageElement>): void {
    const drag = imageDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setImagePan({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY })
  }

  function finishImageDrag(event: ReactPointerEvent<HTMLImageElement>): void {
    const drag = imageDragRef.current
    if (drag?.pointerId === event.pointerId) {
      imageDragRef.current = null
      setImageDragging(false)
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  // 缩略图条自动滚动到当前文件
  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [currentFileId])

  // 切换文件时重置缩放
  useEffect(() => {
    setImageZoom(1)
    setImagePan({ x: 0, y: 0 })
  }, [currentFileId])

  // 窗口级键盘事件：左右箭头切换文件，Esc / Cmd+W 由 BaseModal 处理
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigateFile(-1); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigateFile(1); return }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [modalFiles, currentFileId, onFileChange])

  return (
    <BaseModal onClose={onClose}>
      <section className="preview-modal">
        <PreviewModalHeader
          downloadProgress={downloadProgress}
          file={file}
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
              file={file}
              hasNext={hasNext}
              hasPrevious={hasPrevious}
              imageDragging={imageDragging}
              imagePan={imagePan}
              imageZoom={imageZoom}
              liveError={liveError}
              liveLoading={liveLoading}
              livePlaying={livePlaying}
              livePreviewMessage={livePreview?.message}
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
              currentFileId={currentFileId}
              files={modalFiles}
              stripRef={thumbStripRef}
              onFileChange={onFileChange}
            />
          </div>

          {inspectorOpen && (
            <MediaInspector
              file={file}
              mediaDetails={mediaDetails}
              mediaMetadata={mediaMetadata}
              metadataLoading={metadataLoading}
              isDownloaded={isDownloaded}
              imageZoom={imageZoom}
              baseScale={baseScale}
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetZoom={handleResetZoom}
              onToggleCollapse={() => setInspectorOpen(false)}
              watermarkSettings={effectiveWatermark ? watermarkSettings : undefined}
              onWatermarkChange={effectiveWatermark ? saveWatermarkSettings : undefined}
            />
          )}
        </div>
      </section>
    </BaseModal>
  )
}
