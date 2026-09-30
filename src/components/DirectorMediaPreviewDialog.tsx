import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileVideo2,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'

import type { DirectorLabDownloadProgress, DirectorLanTake } from '../shared/types'
import { formatBytes } from '../lib/format'
import { Button, Dialog, IconButton, VideoControls } from '../ui'

interface DirectorMediaPreviewDialogProps {
  take: DirectorLanTake
  takes: DirectorLanTake[]
  planTitle: string
  downloading: boolean
  downloadProgress?: DirectorLabDownloadProgress | null
  onSelectTake: (take: DirectorLanTake) => void
  onDownload: (take: DirectorLanTake) => void
  onClose: () => void
}

function rangeLabel(take: DirectorLanTake): string {
  if (!take.selected_range) return '完整片段'
  return `${(take.selected_range.start_ms / 1000).toFixed(1)}s - ${(take.selected_range.end_ms / 1000).toFixed(1)}s`
}

export function DirectorMediaPreviewDialog({
  take,
  takes,
  planTitle,
  downloading,
  downloadProgress,
  onSelectTake,
  onDownload,
  onClose,
}: DirectorMediaPreviewDialogProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const prepareRequestRef = useRef(0)
  const autoPlayAfterPrepareRef = useRef(false)
  const [playbackUrl, setPlaybackUrl] = useState(take.stream_url)
  const [preparing, setPreparing] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [mediaSize, setMediaSize] = useState<{ width: number; height: number } | null>(null)
  const portrait = Boolean(mediaSize && mediaSize.height > mediaSize.width)
  const index = takes.findIndex((item) => item.id === take.id)
  const previous = index > 0 ? takes[index - 1] : null
  const next = index >= 0 && index < takes.length - 1 ? takes[index + 1] : null

  useEffect(() => {
    prepareRequestRef.current += 1
    setPlaybackUrl(take.stream_url)
    setPreparing(false)
    autoPlayAfterPrepareRef.current = false
    setPlaybackError(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setWaiting(false)
    setMediaSize(null)
  }, [take.id, take.stream_url])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && previous) onSelectTake(previous)
      if (event.key === 'ArrowRight' && next) onSelectTake(next)
      if (event.key === ' ' && take.kind === 'video') {
        event.preventDefault()
        void togglePlayback()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const prepareCompatiblePreview = useCallback(async (): Promise<void> => {
    if (!take.stream_url) return
    const request = ++prepareRequestRef.current
    autoPlayAfterPrepareRef.current = true
    setPreparing(true)
    setPlaybackError(null)
    try {
      const result = await window.luna.directorLab.preparePreview({
        url: take.stream_url,
        cacheKey: take.id,
      })
      if (prepareRequestRef.current !== request) return
      setPlaybackUrl(result.url)
    } catch (error) {
      if (prepareRequestRef.current !== request) return
      setPlaybackError(error instanceof Error ? error.message : String(error))
    } finally {
      if (prepareRequestRef.current === request) setPreparing(false)
    }
  }, [take.id, take.stream_url])

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current
    if (!video || preparing) return
    if (video.paused) {
      try {
        await video.play()
      } catch {
        if (!playbackUrl?.startsWith('file:')) void prepareCompatiblePreview()
      }
    } else {
      video.pause()
    }
  }

  function seek(time: number): void {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
    setCurrentTime(time)
  }

  return (
    <Dialog open variant="fullscreen" closeOnMaskClick={false} onOpenChange={(open) => !open && onClose()}>
      <section className="lab-viewer">
        <header className="lab-viewer-header">
          <div className="lab-viewer-heading">
            <span className="lab-viewer-kind">{take.kind === 'video' ? <FileVideo2 size={16} /> : <ImageIcon size={16} />}</span>
            <div>
              <h2>{take.file_name}</h2>
              <span>{planTitle} · {take.kind === 'video' ? '视频' : '照片'} · {rangeLabel(take)}</span>
            </div>
          </div>
          <IconButton variant="light" icon={<X size={18} />} onClick={onClose} aria-label="关闭预览" title="关闭预览" />
        </header>

        <div className="lab-viewer-main">
          {previous && (
            <IconButton
              className="lab-viewer-nav previous"
              variant="light"
              icon={<ChevronLeft size={22} />}
              onClick={() => onSelectTake(previous)}
              aria-label="上一段素材"
              title="上一段素材"
            />
          )}
          {next && (
            <IconButton
              className="lab-viewer-nav next"
              variant="light"
              icon={<ChevronRight size={22} />}
              onClick={() => onSelectTake(next)}
              aria-label="下一段素材"
              title="下一段素材"
            />
          )}

          <div className={`lab-viewer-stage ui-video-controls-host${portrait ? ' is-portrait' : ' is-landscape'}`}>
            {take.kind === 'video' ? (
              <>
                <video
                  key={`${take.id}:${playbackUrl}`}
                  ref={videoRef}
                  src={playbackUrl ?? undefined}
                  muted={muted}
                  playsInline
                  preload="metadata"
                  onClick={() => void togglePlayback()}
                  onLoadedMetadata={(event) => {
                    setDuration(event.currentTarget.duration || 0)
                    setMediaSize({
                      width: event.currentTarget.videoWidth,
                      height: event.currentTarget.videoHeight,
                    })
                  }}
                  onCanPlay={(event) => {
                    setWaiting(false)
                    setPlaybackError(null)
                    if (autoPlayAfterPrepareRef.current && playbackUrl?.startsWith('file:')) {
                      autoPlayAfterPrepareRef.current = false
                      void event.currentTarget.play()
                    }
                  }}
                  onWaiting={() => setWaiting(true)}
                  onPlaying={() => { setPlaying(true); setWaiting(false) }}
                  onPause={() => setPlaying(false)}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onEnded={() => setPlaying(false)}
                  onError={() => {
                    if (!playbackUrl) return
                    if (!playbackUrl?.startsWith('file:')) void prepareCompatiblePreview()
                    else setPlaybackError('当前视频无法播放，请下载原素材')
                  }}
                />
                {!playing && !preparing && !playbackError && (
                  <button className="lab-viewer-play" type="button" onClick={() => void togglePlayback()}>
                    <Play size={30} fill="currentColor" />
                  </button>
                )}
                {!preparing && !playbackError && duration > 0 && (
                  <VideoControls
                    playing={playing}
                    currentTime={currentTime}
                    duration={duration}
                    onToggle={() => void togglePlayback()}
                    onSeek={seek}
                    muted={muted}
                    onToggleMute={() => setMuted((value) => !value)}
                  />
                )}
              </>
            ) : playbackUrl ? (
              <img
                src={playbackUrl}
                alt={take.file_name}
                onLoad={(event) => setMediaSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })}
              />
            ) : null}

            {(preparing || waiting) && (
              <div className="lab-viewer-loading">
                <LoaderCircle className="spin" size={28} />
                <span>{preparing ? '正在准备兼容预览' : '正在缓冲'}</span>
              </div>
            )}
            {playbackError && (
              <div className="lab-viewer-error">
                <AlertTriangle size={24} />
                <strong>无法播放这段视频</strong>
                <span>{playbackError}</span>
                <div>
                  <Button variant="secondary" size="compact" icon={<RotateCcw size={15} />} onClick={() => void prepareCompatiblePreview()}>
                    重新准备预览
                  </Button>
                  <Button variant="primary" size="compact" icon={<Download size={15} />} onClick={() => onDownload(take)}>
                    下载原素材
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lab-viewer-filmstrip">
          {takes.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              className={`lab-viewer-thumb${item.id === take.id ? ' active' : ''}`}
              onClick={() => onSelectTake(item)}
              title={item.file_name}
            >
              {item.available && item.stream_url ? (
                item.kind === 'video'
                  ? <video src={item.stream_url} muted preload="metadata" />
                  : <img src={item.stream_url} alt="" />
              ) : <FileVideo2 size={18} />}
              <span>{String(itemIndex + 1).padStart(2, '0')}</span>
            </button>
          ))}
        </div>

        <footer className="lab-viewer-footer">
          <div className="lab-viewer-footer-copy">
            <div className="lab-viewer-file-meta">
              <strong>{take.file_name}</strong>
              <span>{take.size_bytes ? formatBytes(take.size_bytes) : '大小未知'} · {rangeLabel(take)}</span>
            </div>
            {downloadProgress && downloadProgress.phase !== 'done' && (
              <div className="lab-viewer-download-progress">
                <span>{downloadProgress.currentFile ?? '正在准备下载'}</span>
                <div><i style={{ width: `${downloadProgress.percent}%` }} /></div>
                <strong>{downloadProgress.percent}%</strong>
              </div>
            )}
          </div>
          <div className="lab-viewer-actions">
            <Button
              variant="primary"
              size="compact"
              icon={<Download size={15} />}
              disabled={downloading}
              onClick={() => onDownload(take)}
            >
              {downloading ? '下载中' : '下载原素材'}
            </Button>
          </div>
        </footer>
      </section>
    </Dialog>
  )
}
