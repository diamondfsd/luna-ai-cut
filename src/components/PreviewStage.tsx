import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion, Loader2 } from 'lucide-react'

import { LivePhotoPlayer } from './LivePhotoPlayer'
import { WatermarkOverlay } from './WatermarkOverlay'
import { getContainRect, WATERMARK_MARGIN_X_RATIO, WATERMARK_MARGIN_Y_RATIO } from '../shared/watermark'
import type { LunaFile, WatermarkSettings } from '../shared/types'

interface PreviewStageProps {
  displaySource: string | null
  file: LunaFile
  hasNext: boolean
  hasPrevious: boolean
  imageDragging: boolean
  imagePan: { x: number; y: number }
  imageZoom: number
  liveError: string | null
  liveLoading: boolean
  livePlaying: boolean
  livePreviewMessage: string | undefined
  liveReplayKey: number
  liveSource: string | null
  previewFileName: string | undefined
  previewLoading: boolean
  previewMessage: string | undefined
  previewImageRef: React.Ref<HTMLImageElement>
  showWatermarkControls: boolean
  videoRef: React.Ref<HTMLVideoElement>
  watermarkSettings: WatermarkSettings
  finishImageDrag: (event: any) => void
  handleImageDoubleClick: (event: any) => void
  handleImageLoaded: (image: HTMLImageElement) => void
  handleImagePointerDown: (event: any) => void
  handleImagePointerMove: (event: any) => void
  handleVideoLoaded: (video: HTMLVideoElement) => void
  handleVideoTimeUpdate: (video: HTMLVideoElement) => void
  navigateFile: (direction: -1 | 1) => void
  playLivePhoto: () => Promise<void>
  setLiveError: (message: string) => void
}

interface WmLayout {
  x: number
  y: number
  width: number
  height: number
}

/** 水印图片原始尺寸（项目内固定） */
const WM_IMAGE = { width: 2560, height: 400 }

/**
 * 计算水印在屏幕上的像素位置。
 *
 * 策略：与后端一致 —— 水印尺寸用传感器最长边（对齐像素），
 * 边距/位置用展示方向尺寸，最后缩放到屏幕坐标。
 */
function computeWatermarkLayout(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
  settings: WatermarkSettings,
): WmLayout | null {
  if (!settings.enabled || containerW <= 0 || containerH <= 0 || contentW <= 0 || contentH <= 0) {
    return null
  }
  const rect = getContainRect(containerW, containerH, contentW, contentH)
  if (rect.width <= 0 || rect.height <= 0) return null

  // ── 图片坐标空间计算水印 ──
  // 水印尺寸用传感器最长边（与后端一致）
  const sensorW = Math.max(contentW, contentH)
  const wmAspect = WM_IMAGE.height / WM_IMAGE.width
  const pct = settings.watermarkPercent / 100
  const targetW = Math.min(Math.round(sensorW * pct), WM_IMAGE.width)
  const targetH = Math.round(targetW * wmAspect)

  // 边距用展示方向尺寸
  const marginX = Math.round(contentW * WATERMARK_MARGIN_X_RATIO)
  const marginY = Math.round(contentH * WATERMARK_MARGIN_Y_RATIO)

  // 位置用展示方向坐标
  const [vPos, hPos] = settings.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right']
  const imgX = hPos === 'left' ? marginX
    : hPos === 'right' ? contentW - targetW - marginX
    : Math.round((contentW - targetW) / 2)
  const imgY = vPos === 'bottom' ? contentH - targetH - marginY : marginY

  // ── 缩放到屏幕坐标 ──
  const scale = rect.scale
  const result = {
    x: Math.round(rect.x + imgX * scale),
    y: Math.round(rect.y + imgY * scale),
    width: Math.round(targetW * scale),
    height: Math.round(targetH * scale),
  }

  // eslint-disable-next-line no-console
  console.log('[wm preview]', {
    stage: `${containerW}×${containerH}`,
    natural: `${contentW}×${contentH}`,
    sensorW,
    containRect: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
    scale: scale.toFixed(4),
    imgCoord: `(${imgX}, ${imgY}) ${targetW}×${targetH}`,
    screenCoord: `(${result.x}, ${result.y}) ${result.width}×${result.height}`,
    settings: `${settings.watermarkPercent}% / ${settings.position}`,
  })

  return result
}

export function PreviewStage({
  displaySource,
  file,
  hasNext,
  hasPrevious,
  imageDragging,
  imagePan,
  imageZoom,
  liveError,
  liveLoading,
  livePlaying,
  livePreviewMessage,
  liveReplayKey,
  liveSource,
  previewFileName,
  previewLoading,
  previewMessage,
  previewImageRef,
  showWatermarkControls,
  videoRef,
  watermarkSettings,
  finishImageDrag,
  handleImageDoubleClick,
  handleImageLoaded,
  handleImagePointerDown,
  handleImagePointerMove,
  handleVideoLoaded,
  handleVideoTimeUpdate,
  navigateFile,
  playLivePhoto,
  setLiveError,
}: PreviewStageProps) {
  const mediaTransform = `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })

  // 监听舞台尺寸变化
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.contentBoxSize[0] ?? entry.contentBoxSize
        setStageSize({ width: inlineSize, height: blockSize })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 图片加载完成时记录内容尺寸
  const onImageLoad = useCallback((image: HTMLImageElement) => {
    setContentSize({ width: image.naturalWidth, height: image.naturalHeight })
    handleImageLoaded(image)
  }, [handleImageLoaded])

  // 视频加载完成时记录内容尺寸
  const onVideoLoad = useCallback((video: HTMLVideoElement) => {
    setContentSize({ width: video.videoWidth, height: video.videoHeight })
    handleVideoLoaded(video)
  }, [handleVideoLoaded])

  // 计算水印布局
  const wmLayout = computeWatermarkLayout(
    stageSize.width, stageSize.height,
    contentSize.width, contentSize.height,
    watermarkSettings,
  )

  return (
    <div className="preview-stage" ref={stageRef}>
      {hasPrevious && (
        <button className="preview-nav previous" onClick={() => navigateFile(-1)} title="上一张">
          <ChevronLeft size={24} />
        </button>
      )}
      {hasNext && (
        <button className="preview-nav next" onClick={() => navigateFile(1)} title="下一张">
          <ChevronRight size={24} />
        </button>
      )}
      {previewLoading && <Loader2 className="spin" size={38} />}
      {!previewLoading && file.isLivePhoto && (
        <button
          className={`live-photo-chip preview-live-chip ${livePlaying ? 'is-playing' : ''}`}
          onClick={() => void playLivePhoto()}
          disabled={liveLoading}
          title="播放 LIVE 照片"
        >
          {liveLoading ? (
            <Loader2 className="spin" size={13} />
          ) : (
            <span className="live-photo-symbol" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </button>
      )}
      {!previewLoading && liveError && <div className="live-photo-error">{liveError}</div>}
      {!previewLoading && livePlaying && liveSource && displaySource && (
        <div
          className={`${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`}
          onPointerDown={handleImagePointerDown}
          onPointerMove={handleImagePointerMove}
          onPointerUp={finishImageDrag}
          onPointerCancel={finishImageDrag}
          style={{
            width: '100%',
            height: '100%',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            cursor: imageZoom > 1 ? 'grab' : undefined,
            transform: mediaTransform,
          }}
        >
          <LivePhotoPlayer
            key={`${file.id}-${liveReplayKey}`}
            photoSrc={displaySource}
            videoSrc={liveSource}
            autoPlay
            onError={(message) => setLiveError(message)}
          />
        </div>
      )}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'image' && (
        <div className="preview-media-wrapper">
          <div
            className={`preview-media-inner ${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`}
            style={{ transform: mediaTransform }}
          >
            <img
              ref={previewImageRef}
              src={displaySource}
              alt={previewFileName ?? file.name}
              onLoad={(event) => onImageLoad(event.currentTarget)}
              onDoubleClick={handleImageDoubleClick}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={finishImageDrag}
              onPointerCancel={finishImageDrag}
            />
            {showWatermarkControls && wmLayout && (
              <WatermarkOverlay
                settings={watermarkSettings}
                kind="image"
                x={wmLayout.x}
                y={wmLayout.y}
                width={wmLayout.width}
                height={wmLayout.height}
                className="watermark-overlay"
              />
            )}
          </div>
        </div>
      )}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'video' && (
        <div className="preview-media-wrapper">
          <div className="preview-media-inner">
            <video
              ref={videoRef}
              src={displaySource}
              controls
              autoPlay
              style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
              onLoadedMetadata={(event) => onVideoLoad(event.currentTarget)}
              onTimeUpdate={(event) => handleVideoTimeUpdate(event.currentTarget)}
            />
            {showWatermarkControls && wmLayout && (
              <WatermarkOverlay
                settings={watermarkSettings}
                kind="video"
                x={wmLayout.x}
                y={wmLayout.y}
                width={wmLayout.width}
                height={wmLayout.height}
                className="watermark-overlay"
              />
            )}
          </div>
        </div>
      )}
      {!previewLoading && !displaySource && !liveSource && (
        <div className="unknown-preview">
          <FileQuestion size={50} />
          <span>{liveError ?? livePreviewMessage ?? previewMessage ?? '暂无预览'}</span>
        </div>
      )}

    </div>
  )
}
