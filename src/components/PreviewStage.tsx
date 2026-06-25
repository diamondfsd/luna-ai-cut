import type { RefObject } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion, Loader2 } from 'lucide-react'

import { LivePhotoPlayer } from './LivePhotoPlayer'
import { WatermarkOverlay } from './WatermarkOverlay'
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
  previewImageRef: RefObject<HTMLImageElement>
  showWatermarkControls: boolean
  videoRef: RefObject<HTMLVideoElement>
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

  return (
    <div className="preview-stage">
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
              onLoad={(event) => handleImageLoaded(event.currentTarget)}
              onDoubleClick={handleImageDoubleClick}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={finishImageDrag}
              onPointerCancel={finishImageDrag}
            />
            {showWatermarkControls && <WatermarkOverlay settings={watermarkSettings} kind="image" />}
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
              onLoadedMetadata={(event) => handleVideoLoaded(event.currentTarget)}
              onTimeUpdate={(event) => handleVideoTimeUpdate(event.currentTarget)}
            />
            {showWatermarkControls && <WatermarkOverlay settings={watermarkSettings} kind="video" />}
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
