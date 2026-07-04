import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion, Loader2 } from 'lucide-react'

import { LivePhotoPlayer } from './LivePhotoPlayer'
import { LivePhotoBadge } from '../ui'
import { WatermarkOverlay } from './WatermarkOverlay'
import { getContainRect } from '../shared/watermark'
import { resolveWatermarkRatios } from '../shared/watermark/layoutConfig'
import { loadWatermarkImage } from '../shared/watermarkAssets'
import type { LunaFile, WatermarkSettings } from '../shared/types'

interface PreviewStageProps {
  displaySource: string | null
  file: LunaFile
  hasNext: boolean; hasPrevious: boolean
  imageDragging: boolean; imagePan: { x: number; y: number }; imageZoom: number
  liveError: string | null; liveLoading: boolean; livePlaying: boolean
  livePreviewMessage: string | undefined; liveReplayKey: number; liveSource: string | null
  previewFileName: string | undefined; previewLoading: boolean; previewMessage: string | undefined
  previewImageRef: React.Ref<HTMLImageElement>; showWatermarkControls: boolean; videoRef: React.Ref<HTMLVideoElement>
  watermarkSettings: WatermarkSettings
  finishImageDrag: (event: any) => void; handleImageDoubleClick: (event: any) => void
  handleImageLoaded: (image: HTMLImageElement) => void
  handleImagePointerDown: (event: any) => void; handleImagePointerMove: (event: any) => void
  handleVideoLoaded: (video: HTMLVideoElement) => void; handleVideoTimeUpdate: (video: HTMLVideoElement) => void
  navigateFile: (direction: -1 | 1) => void; playLivePhoto: () => Promise<void>; setLiveError: (message: string) => void
}

function computeWmLayout(
  containerW: number, containerH: number, contentW: number, contentH: number,
  settings: WatermarkSettings, wmW: number, wmH: number, deviceId?: string | null,
) {
  if (!settings.enabled || containerW <= 0 || contentW <= 0) return null
  const rect = getContainRect(containerW, containerH, contentW, contentH)
  if (rect.width <= 0) return null
  const ratios = resolveWatermarkRatios(deviceId, settings.style, contentW, contentH, settings.position)
  if (!ratios) return null
  const sensorW = Math.max(contentW, contentH)
  const targetW = Math.round(sensorW * ratios.widthRatio)
  const targetH = Math.round(targetW * (wmH / wmW))
  const [vPos] = settings.position.split('-') as ['top' | 'bottom']
  const imgX = Math.round(ratios.xRatio * contentW)
  const imgY = vPos === 'bottom' ? contentH - targetH - Math.round(ratios.yRatio * contentH) : Math.round((1 - ratios.yRatio) * contentH)
  const scale = rect.scale
  return { x: Math.round(rect.x + imgX * scale), y: Math.round(rect.y + imgY * scale), width: Math.round(targetW * scale), height: Math.round(targetH * scale) }
}

export function PreviewStage(props: PreviewStageProps) {
  const {
    displaySource, file, hasNext, hasPrevious,
    imageDragging, imagePan, imageZoom,
    liveError, liveLoading, livePlaying, livePreviewMessage, liveReplayKey, liveSource,
    previewFileName, previewLoading, previewMessage, previewImageRef,
    showWatermarkControls, videoRef, watermarkSettings,
    finishImageDrag, handleImageDoubleClick, handleImageLoaded,
    handleImagePointerDown, handleImagePointerMove,
    handleVideoLoaded, handleVideoTimeUpdate,
    navigateFile, playLivePhoto, setLiveError,
  } = props

  const mediaTransform = `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })

  // 舞台尺寸
  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.contentBoxSize[0] ?? entry.contentBoxSize
        setStageSize({ width: inlineSize, height: blockSize })
      }
    })
    ro.observe(el); return () => ro.disconnect()
  }, [])

  const onImageLoad = useCallback((image: HTMLImageElement) => {
    setContentSize({ width: image.naturalWidth, height: image.naturalHeight })
    handleImageLoaded(image)
  }, [handleImageLoaded])

  const onVideoLoad = useCallback((video: HTMLVideoElement) => {
    setContentSize({ width: video.videoWidth, height: video.videoHeight })
    handleVideoLoaded(video)
  }, [handleVideoLoaded])

  // 水印状态
  const [wmSize, setWmSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    if (!watermarkSettings.enabled) { setWmSize(null); return }
    let cancelled = false
    loadWatermarkImage(watermarkSettings.style, file.kind === 'video' ? 'video' : 'image')
      .then((info) => { if (!cancelled) setWmSize(info) }).catch(() => setWmSize(null))
    return () => { cancelled = true }
  }, [watermarkSettings.enabled, watermarkSettings.style, file.kind])
  const wmLayout = wmSize ? computeWmLayout(stageSize.width, stageSize.height, contentSize.width, contentSize.height, watermarkSettings, wmSize.width, wmSize.height, file.sourceDeviceId) : null

  return (
    <div className="preview-stage" ref={stageRef}>
      {hasPrevious && <button className="preview-nav previous" onClick={() => navigateFile(-1)} title="上一张"><ChevronLeft size={24} /></button>}
      {hasNext && <button className="preview-nav next" onClick={() => navigateFile(1)} title="下一张"><ChevronRight size={24} /></button>}
      {previewLoading && <Loader2 className="spin" size={38} />}

      {/* ── Live Photo ── */}
      {!previewLoading && file.isLivePhoto && (
        <button className={`live-photo-chip preview-live-chip ${livePlaying ? 'is-playing' : ''}`} onClick={() => void playLivePhoto()} disabled={liveLoading} title="播放 LIVE 照片">
          {liveLoading ? <Loader2 className="spin" size={13} /> : <LivePhotoBadge size={42} />}
        </button>
      )}
      {!previewLoading && liveError && <div className="live-photo-error">{liveError}</div>}
      {!previewLoading && livePlaying && liveSource && displaySource && (
        <div
          className={`${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`}
          onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove}
          onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag}
          style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: imageZoom > 1 ? 'grab' : undefined, transform: mediaTransform }}
        >
          <LivePhotoPlayer key={`${file.id}-${liveReplayKey}`} photoSrc={displaySource} videoSrc={liveSource} autoPlay onError={(msg) => setLiveError(msg)} />
          {showWatermarkControls && wmLayout && <WatermarkOverlay settings={watermarkSettings} kind="image" x={wmLayout.x} y={wmLayout.y} width={wmLayout.width} height={wmLayout.height} className="watermark-overlay" />}
        </div>
      )}

      {/* ── 图片 ── */}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'image' && (
        <div className="preview-media-wrapper">
          <div
            className={`preview-media-inner ${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`}
            style={{ transform: mediaTransform }}
          >
            <img ref={previewImageRef} src={displaySource} alt={previewFileName ?? file.name}
              onLoad={(e) => onImageLoad(e.currentTarget)}
              onDoubleClick={handleImageDoubleClick}
              onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove}
              onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} />
            {showWatermarkControls && wmLayout && (
              <WatermarkOverlay settings={watermarkSettings} kind="image" x={wmLayout.x} y={wmLayout.y} width={wmLayout.width} height={wmLayout.height} className="watermark-overlay" />
            )}
          </div>
        </div>
      )}

      {/* ── 视频：原生 <video controls> ── */}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'video' && (
        <div className="preview-media-wrapper">
          <div className="preview-media-inner">
            <video ref={videoRef} src={displaySource} controls autoPlay
              style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
              onLoadedMetadata={(e) => onVideoLoad(e.currentTarget)}
              onTimeUpdate={(e) => handleVideoTimeUpdate(e.currentTarget)} />
            {showWatermarkControls && wmLayout && <WatermarkOverlay settings={watermarkSettings} kind="video" x={wmLayout.x} y={wmLayout.y} width={wmLayout.width} height={wmLayout.height} className="watermark-overlay" />}
          </div>
        </div>
      )}

      {!previewLoading && !displaySource && !liveSource && (
        <div className="unknown-preview"><FileQuestion size={50} /><span>{liveError ?? livePreviewMessage ?? previewMessage ?? '暂无预览'}</span></div>
      )}
    </div>
  )
}
