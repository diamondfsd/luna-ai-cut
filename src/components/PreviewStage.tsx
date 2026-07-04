import { useRef } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion, Loader2 } from 'lucide-react'
import { LivePhotoPlayer } from './LivePhotoPlayer'
import { LivePhotoBadge } from '../ui'
import type { LunaFile } from '../shared/types'

interface PreviewStageProps {
  displaySource: string | null; file: LunaFile
  hasNext: boolean; hasPrevious: boolean
  imageDragging: boolean; imagePan: { x: number; y: number }; imageZoom: number
  liveError: string | null; liveLoading: boolean; livePlaying: boolean
  livePreviewMessage: string | undefined; liveReplayKey: number; liveSource: string | null
  previewFileName: string | undefined; previewLoading: boolean; previewMessage: string | undefined
  previewImageRef: React.Ref<HTMLImageElement>; videoRef: React.Ref<HTMLVideoElement>
  finishImageDrag: (e: any) => void; handleImageDoubleClick: (e: any) => void
  handleImageLoaded: (img: HTMLImageElement) => void
  handleImagePointerDown: (e: any) => void; handleImagePointerMove: (e: any) => void
  handleVideoLoaded: (v: HTMLVideoElement) => void; handleVideoTimeUpdate: (v: HTMLVideoElement) => void
  navigateFile: (d: -1 | 1) => void; playLivePhoto: () => Promise<void>; setLiveError: (m: string) => void
}

export function PreviewStage(props: PreviewStageProps) {
  const { displaySource, file, hasNext, hasPrevious, imageDragging, imagePan, imageZoom,
    liveError, liveLoading, livePlaying, livePreviewMessage, liveReplayKey, liveSource,
    previewFileName, previewLoading, previewMessage, previewImageRef, videoRef,
    finishImageDrag, handleImageDoubleClick, handleImageLoaded,
    handleImagePointerDown, handleImagePointerMove,
    handleVideoLoaded, handleVideoTimeUpdate,
    navigateFile, playLivePhoto, setLiveError } = props

  const mediaTransform = `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`
  const stageRef = useRef<HTMLDivElement | null>(null)

  return (
    <div className="preview-stage" ref={stageRef}>
      {hasPrevious && <button className="preview-nav previous" onClick={() => navigateFile(-1)}><ChevronLeft size={24} /></button>}
      {hasNext && <button className="preview-nav next" onClick={() => navigateFile(1)}><ChevronRight size={24} /></button>}
      {previewLoading && <Loader2 className="spin" size={38} />}
      {!previewLoading && file.isLivePhoto && <button className={`live-photo-chip preview-live-chip ${livePlaying ? 'is-playing' : ''}`} onClick={() => void playLivePhoto()} disabled={liveLoading}>{liveLoading ? <Loader2 className="spin" size={13} /> : <LivePhotoBadge size={42} />}</button>}
      {!previewLoading && liveError && <div className="live-photo-error">{liveError}</div>}
      {!previewLoading && livePlaying && liveSource && displaySource && (
        <div className={`${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`} onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove} onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: imageZoom > 1 ? 'grab' : undefined, transform: mediaTransform }}>
          <LivePhotoPlayer key={`${file.id}-${liveReplayKey}`} photoSrc={displaySource} videoSrc={liveSource} autoPlay onError={(msg) => setLiveError(msg)} />
        </div>
      )}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'image' && (
        <div className="preview-media-wrapper">
          <div className={`preview-media-inner ${imageZoom > 1 ? 'zoomed' : ''} ${imageDragging ? 'dragging' : ''}`} style={{ transform: mediaTransform }}
            onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove}
            onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} onDoubleClick={handleImageDoubleClick}>
            <img ref={previewImageRef} src={displaySource} alt={previewFileName ?? file.name}
              onLoad={(e) => handleImageLoaded(e.currentTarget)} onDoubleClick={handleImageDoubleClick}
              onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove}
              onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} />
          </div>
        </div>
      )}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'video' && (
        <div className="preview-media-wrapper"><div className="preview-media-inner">
          <video ref={videoRef} src={displaySource} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
            onLoadedMetadata={(e) => handleVideoLoaded(e.currentTarget)} onTimeUpdate={(e) => handleVideoTimeUpdate(e.currentTarget)} />
        </div></div>
      )}
      {!previewLoading && !displaySource && !liveSource && <div className="unknown-preview"><FileQuestion size={50} /><span>{liveError ?? livePreviewMessage ?? previewMessage ?? '暂无预览'}</span></div>}
    </div>
  )
}
