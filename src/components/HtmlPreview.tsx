import { useEffect, useMemo, useRef, useState } from 'react'
import { Info, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'

import { filePathToPreviewUrl, mediaKindFromPath } from '../lib/fileUtils'
import { useIsLivePhoto } from '../shared/livePhoto'
import type { PreviewLayer } from '../shared/types'
import { IconButton, LivePhotoBadge } from '../ui'
import { containPreviewSize, resolveWatermarkPositioning, watermarkPositionStyle, type PreviewSize } from './htmlPreviewGeometry'
import { useHtmlPreviewViewport } from './useHtmlPreviewViewport'
import './HtmlPreview.css'

interface HtmlPreviewProps {
  url: string | null
  mediaPath?: string | null
  proxyPreview?: boolean
  watermarkLayer?: PreviewLayer
}

export function HtmlPreview({ url, mediaPath, proxyPreview = false, watermarkLayer }: HtmlPreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState<PreviewSize>({ width: 0, height: 0 })
  const sourceKey = mediaPath ?? url
  const [mediaMetrics, setMediaMetrics] = useState<{ key: string; size: PreviewSize } | null>(null)
  const [mediaError, setMediaError] = useState(false)
  const [watermarkError, setWatermarkError] = useState(false)
  const [liveVideoUrl, setLiveVideoUrl] = useState<string | null>(null)
  const [livePlaying, setLivePlaying] = useState(false)
  const isLivePhoto = useIsLivePhoto(url)
  const sourceKind = mediaKindFromPath(mediaPath ?? url ?? '')
  const mediaSize = mediaMetrics?.key === sourceKey ? mediaMetrics.size : null

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [url])

  useEffect(() => {
    let canceled = false
    if (!mediaPath) return
    window.luna.workspace.getMediaResolution(mediaPath)
      .then((size) => { if (!canceled) setMediaMetrics({ key: sourceKey!, size }) })
      .catch(() => {})
    return () => { canceled = true }
  }, [mediaPath, sourceKey])

  useEffect(() => {
    setMediaError(false)
    setWatermarkError(false)
  }, [sourceKey, watermarkLayer?.filePath])

  useEffect(() => {
    let canceled = false
    setLivePlaying(false)
    setLiveVideoUrl(null)
    if (!isLivePhoto || !url) return
    window.luna.previewLivePhoto(url)
      .then((result) => { if (!canceled) setLiveVideoUrl(result.source ?? null) })
      .catch(() => {})
    return () => { canceled = true }
  }, [isLivePhoto, url])

  const frameSize = useMemo(() => mediaSize ? containPreviewSize(viewportSize, mediaSize) : viewportSize, [mediaSize, viewportSize])
  const viewport = useHtmlPreviewViewport({ containerRef: viewportRef, contentRef, mediaSize, sourceKey })
  const positioning = watermarkLayer && mediaSize ? resolveWatermarkPositioning(watermarkLayer, mediaSize) : null
  const watermarkUrl = watermarkLayer ? filePathToPreviewUrl(watermarkLayer.filePath) : null
  function rememberMediaSize(width: number, height: number): void {
    if (sourceKey && width > 0 && height > 0) {
      setMediaMetrics((current) => current?.key === sourceKey ? current : { key: sourceKey, size: { width, height } })
    }
  }

  function toggleLivePhoto(): void {
    if (liveVideoUrl) setLivePlaying((current) => !current)
  }

  if (!url) {
    return <div className="html-preview-loading">正在加载...</div>
  }

  const media = isLivePhoto && livePlaying && liveVideoUrl ? (
    <video
      src={liveVideoUrl}
      autoPlay
      muted
      playsInline
      onLoadedMetadata={(event) => rememberMediaSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      onError={() => setMediaError(true)}
      onEnded={() => setLivePlaying(false)}
    />
  ) : sourceKind === 'video' ? (
    <video
      src={url}
      controls
      autoPlay
      playsInline
      onLoadedMetadata={(event) => rememberMediaSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
      onError={() => setMediaError(true)}
    />
  ) : (
    <img
      src={url}
      alt=""
      draggable={false}
      onLoad={(event) => rememberMediaSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
      onError={() => setMediaError(true)}
    />
  )

  return (
    <div
      ref={viewportRef}
      className={`html-preview-viewport${viewport.isZoomed ? ' is-zoomed' : ''}${viewport.dragging ? ' is-dragging' : ''}`}
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.onPointerUp}
      onPointerCancel={viewport.onPointerCancel}
      onWheel={viewport.onWheel}
      onDoubleClick={viewport.onDoubleClick}
    >
      <div className="html-preview-tools" data-preview-control>
        <IconButton variant="light" size="compact" icon={<ZoomOut size={16} />} onClick={viewport.zoomOut} disabled={!viewport.canZoomOut} title="缩小" />
        <IconButton variant="light" size="compact" icon={<Maximize2 size={15} />} onClick={viewport.reset} disabled={!viewport.isZoomed} title="适应窗口" />
        <IconButton variant="light" size="compact" icon={<ZoomIn size={16} />} onClick={viewport.zoomIn} disabled={!viewport.canZoomIn} title="放大" />
      </div>
      {proxyPreview && (
        <div className="html-preview-quality-notice" data-preview-control>
          <Info size={14} />
          <span>当前为流畅预览画质，不代表原始素材质量。下载后可查看完整画质。</span>
        </div>
      )}
      <div
        ref={contentRef}
        className="html-preview-content"
        style={{ width: frameSize.width, height: frameSize.height, ...viewport.style }}
      >
        {!mediaError && media}
        {!watermarkError && watermarkUrl && positioning && (
          <img
            className="html-preview-watermark"
            src={watermarkUrl}
            alt=""
            style={{ ...watermarkPositionStyle(positioning), opacity: watermarkLayer?.opacity ?? 1 }}
            onError={() => setWatermarkError(true)}
          />
        )}
      </div>
      {mediaError && (
        <div className="html-preview-error" data-preview-control>
          当前文件无法直接预览，请查看或下载原文件。
        </div>
      )}
      {isLivePhoto && (
        <div className="html-preview-live-control" data-preview-control>
          <LivePhotoBadge
            size={32}
            onClick={toggleLivePhoto}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleLivePhoto()
              }
            }}
            aria-label={livePlaying ? '停止播放' : '播放 Live 图'}
          />
        </div>
      )}
    </div>
  )
}
