import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion, Loader2 } from 'lucide-react'
import { LivePhotoPlayer } from './LivePhotoPlayer'
import { LivePhotoBadge } from '../ui'
import type { LunaFile } from '../shared/types'

interface StaticLayer { imagePath: string; dstX: number; dstY: number; dstW: number; dstH: number; srcX: number; srcY: number; srcW: number; srcH: number; opacity: number; zIndex: number }

interface PreviewStageProps {
  displaySource: string | null; file: LunaFile
  hasNext: boolean; hasPrevious: boolean
  imageDragging: boolean; imagePan: { x: number; y: number }; imageZoom: number
  liveError: string | null; liveLoading: boolean; livePlaying: boolean
  livePreviewMessage: string | undefined; liveReplayKey: number; liveSource: string | null
  previewFileName: string | undefined; previewLoading: boolean; previewMessage: string | undefined
  previewImageRef: React.Ref<HTMLImageElement>; showWatermarkControls: boolean; videoRef: React.Ref<HTMLVideoElement>
  watermarkSettings: WatermarkSettings
  localPath?: string | null; nativeLayers?: StaticLayer[] | null
  finishImageDrag: (e: any) => void; handleImageDoubleClick: (e: any) => void
  handleImageLoaded: (img: HTMLImageElement) => void
  handleImagePointerDown: (e: any) => void; handleImagePointerMove: (e: any) => void
  handleVideoLoaded: (v: HTMLVideoElement) => void; handleVideoTimeUpdate: (v: HTMLVideoElement) => void
  navigateFile: (d: -1 | 1) => void; playLivePhoto: () => Promise<void>; setLiveError: (m: string) => void
}

function getLRC() { return (window as any).lunaRenderCore as { init: () => Promise<void>; previewFile: (p: string, w: number, h: number, l: any[]) => Promise<Uint8Array> } | undefined }

export function PreviewStage(props: PreviewStageProps) {
  const { displaySource, file, hasNext, hasPrevious, imageDragging, imagePan, imageZoom,
    liveError, liveLoading, livePlaying, livePreviewMessage, liveReplayKey, liveSource,
    previewFileName, previewLoading, previewMessage, previewImageRef,
    showWatermarkControls, videoRef, watermarkSettings,
    localPath, nativeLayers,
    finishImageDrag, handleImageDoubleClick, handleImageLoaded,
    handleImagePointerDown, handleImagePointerMove,
    handleVideoLoaded, handleVideoTimeUpdate,
    navigateFile, playLivePhoto, setLiveError } = props

  const mediaTransform = `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom})`
  const stageRef = useRef<HTMLDivElement | null>(null)
  const nativeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const [rcReady, setRcReady] = useState(false)

  const useNative = !!(nativeLayers && nativeLayers.length > 0 && localPath)

  useEffect(() => { if (!useNative) return; getLRC()?.init().then(() => setRcReady(true)).catch(() => {}) }, [useNative])

  useEffect(() => {
    const el = stageRef.current; if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { inlineSize, blockSize } = entry.contentBoxSize[0] ?? entry.contentBoxSize
        setStageSize({ width: inlineSize, height: blockSize })
      }
    }); ro.observe(el); return () => ro.disconnect()
  }, [])

  const onImageLoad = useCallback((image: HTMLImageElement) => {
    setContentSize({ width: image.naturalWidth, height: image.naturalHeight }); handleImageLoaded(image)
  }, [handleImageLoaded])

  // Native Core 渲染
  useEffect(() => {
    if (!useNative || !rcReady || !localPath || !nativeLayers) return
    let cancelled = false
    const img = new Image()
    img.onload = async () => {
      if (cancelled) return
      const lrc = getLRC(); const cvs = nativeCanvasRef.current; if (!lrc || !cvs) return
      try {
        const result = await lrc.previewFile(localPath, img.naturalWidth, img.naturalHeight, nativeLayers)
        cvs.width = img.naturalWidth; cvs.height = img.naturalHeight
        cvs.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(result), img.naturalWidth, img.naturalHeight), 0, 0)
      } catch {}
    }; img.src = `file://${localPath}`
    return () => { cancelled = true }
  }, [useNative, rcReady, localPath, nativeLayers])

  const onVideoLoad = useCallback((v: HTMLVideoElement) => {
    setContentSize({ width: v.videoWidth, height: v.videoHeight }); handleVideoLoaded(v)
  }, [handleVideoLoaded])

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
            {useNative ? (
              <canvas ref={nativeCanvasRef} style={{ maxWidth: '100%', maxHeight: '100%' }} />
            ) : (
              <>
                <img ref={previewImageRef} src={displaySource} alt={previewFileName ?? file.name}
                  onLoad={(e) => onImageLoad(e.currentTarget)} onDoubleClick={handleImageDoubleClick}
                  onPointerDown={handleImagePointerDown} onPointerMove={handleImagePointerMove}
                  onPointerUp={finishImageDrag} onPointerCancel={finishImageDrag} />
              </>
            )}
          </div>
        </div>
      )}
      {!previewLoading && !livePlaying && displaySource && file.kind === 'video' && (
        <div className="preview-media-wrapper"><div className="preview-media-inner">
          <video ref={videoRef} src={displaySource} controls autoPlay style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
            onLoadedMetadata={(e) => onVideoLoad(e.currentTarget)} onTimeUpdate={(e) => handleVideoTimeUpdate(e.currentTarget)} />
        </div></div>
      )}
      {!previewLoading && !displaySource && !liveSource && <div className="unknown-preview"><FileQuestion size={50} /><span>{liveError ?? livePreviewMessage ?? previewMessage ?? '暂无预览'}</span></div>}
    </div>
  )
}

