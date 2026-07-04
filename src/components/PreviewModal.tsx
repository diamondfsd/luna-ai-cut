import { useEffect, useMemo, useRef, useState } from 'react'
import { MediaInspector } from './MediaInspector'
import { PreviewModalHeader } from './PreviewModalHeader'
import { PreviewStage } from './PreviewStage'
import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { filePathToLunaFile, filePathToPreviewUrl, thumbnailForPath } from './previewModalUtils'
import type { DownloadProgress, LunaFile, PreviewResult, WatermarkSettings as WatermarkSettingsType } from '../shared/types'
import { luna_ultra_layout, STYLE_TO_THEME } from '../shared/watermark/layoutConfig'
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
  autoPlayLive?: boolean

  /** @deprecated 逐渐淘汰 */
  preview?: PreviewResult | null
  /** @deprecated 不再使用 */
  previewLoading?: boolean
  downloadProgress?: DownloadProgress
  isDownloadsPage?: boolean
}

export function PreviewModal({
  filePath,
  files: propFiles,
  currentFile: propCurrentFile,
  onFileChange,
  onClose,
  onReveal,
  onDownload,
  preview: deprecatedPreview,
  downloadProgress,
}: PreviewModalProps) {
  const thumbStripRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)

  // ── 从文件路径推导文件信息 ──
  const internalFile = useMemo(() => filePathToLunaFile(filePath, {
    thumbnailUrl: thumbnailForPath(filePath),
  }), [filePath])

  // ── Live Photo 检测（异步读文件判断是否为 Google Motion Photo） ──
  const [fileIsLivePhoto, setFileIsLivePhoto] = useState(false)
  useEffect(() => {
    let cancelled = false
    const base = propCurrentFile ?? internalFile
    if (propCurrentFile?.isLivePhoto) {
      // propCurrentFile 已确认是 Live Photo，直接沿用
      setFileIsLivePhoto(true)
    } else if (base.kind === 'image' && filePath) {
      setFileIsLivePhoto(false) // 重置
      console.log('[PreviewModal] checking isLivePhoto for', filePath)
      window.luna.workspace.isLivePhoto(filePath).then((live) => {
        console.log('[PreviewModal] isLivePhoto result:', live)
        if (!cancelled) setFileIsLivePhoto(live)
      }).catch((err) => {
        console.error('[PreviewModal] isLivePhoto error:', err)
      })
    } else {
      setFileIsLivePhoto(false)
    }
    return () => { cancelled = true }
  }, [filePath, propCurrentFile, internalFile.kind])

  // 若异步检测发现是 Live Photo，合并到 file 对象中
  const file = useMemo(() => {
    const base = propCurrentFile ?? internalFile
    if (fileIsLivePhoto && !base.isLivePhoto) {
      return { ...base, isLivePhoto: true }
    }
    return base
  }, [propCurrentFile, internalFile, fileIsLivePhoto])

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
  const [, setInternalPreviewLoading] = useState(false)

  const preview = deprecatedPreview ?? internalPreview

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
  const [, setImageZoom] = useState(1)
  const [, setImagePan] = useState({ x: 0, y: 0 })
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [watermarkSettings] = useState<WatermarkSettingsType>({
    enabled: true,
    style: 'luna_ultra',
    position: 'BottomCenter' as any,
  })

  const completedDownloadPath = downloadProgress?.status === 'done' || downloadProgress?.status === 'exists'
    ? downloadProgress.destinationPath ?? null
    : null
  const downloadedPath = file.downloadFilePath ?? file.localPath ?? completedDownloadPath
  const previewMatchesFile = preview?.fileName === file.name
  const displaySource = downloadedPath ? filePathToPreviewUrl(downloadedPath) : previewMatchesFile ? preview?.source ?? null : null

  // 切换文件时打印水印参数
  useEffect(() => {
    if (!watermarkSettings.enabled) return
    const theme = STYLE_TO_THEME[watermarkSettings.style]
    if (!theme) return
    const key = `${theme}|16:9|${watermarkSettings.position}`
    const ratios = luna_ultra_layout[key]
    console.log(`[PreviewModal] 切换文件: ${file.name}`, {
      style: watermarkSettings.style,
      position: watermarkSettings.position,
      deviceId: file.sourceDeviceId,
      layoutKey: key,
      ratios,
    })
  }, [file.id, watermarkSettings.enabled, watermarkSettings.style, watermarkSettings.position])

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
          file={file}
          downloadProgress={downloadProgress}
          inspectorOpen={inspectorOpen}
          onSetInspectorOpen={setInspectorOpen}
          onClose={onClose}
          onDownload={onDownload}
          onReveal={onReveal}
        />

        <div className={`preview-body${inspectorOpen ? '' : ' inspector-collapsed'}`}>
          <div className="preview-stage-col">
            <PreviewStage url={displaySource} />

            <PreviewThumbnailStrip
              activeThumbRef={activeThumbRef}
              currentFileId={file.id}
              files={modalFiles}
              stripRef={thumbStripRef}
              onFileChange={(f) => onFileChange?.(f)}
            />
          </div>

          {inspectorOpen && <MediaInspector filePath={filePath} onToggleCollapse={() => setInspectorOpen(false)} />}
        </div>
      </section>
    </Dialog>
  )
}
