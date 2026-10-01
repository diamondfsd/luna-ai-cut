import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileVideo2,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'

import type { DirectorLabDownloadProgress, DirectorLanShot, DirectorLanTake } from '../shared/types'
import { formatBytes } from '../lib/format'
import { Button, Dialog, IconButton, VideoControls } from '../ui'
import './DirectorMediaPreviewDialog.css'

interface DirectorMediaPreviewDialogProps {
  take: DirectorLanTake
  shot: DirectorLanShot
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
  shot,
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
  const autoPlayPendingRef = useRef(true)
  const [playbackUrl, setPlaybackUrl] = useState(take.stream_url)
  const [preparing, setPreparing] = useState(false)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const index = takes.findIndex((item) => item.id === take.id)
  const previous = index > 0 ? takes[index - 1] : null
  const next = index >= 0 && index < takes.length - 1 ? takes[index + 1] : null
  const nextVideo = index >= 0
    ? takes.slice(index + 1).find((item) => item.kind === 'video' && item.available && item.stream_url) ?? null
    : null

  useEffect(() => {
    prepareRequestRef.current += 1
    autoPlayPendingRef.current = true
    setPlaybackUrl(take.stream_url)
    setPreparing(false)
    setPlaybackError(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setWaiting(false)
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
    autoPlayPendingRef.current = true
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

  async function startPlayback(video: HTMLVideoElement): Promise<void> {
    try {
      await video.play()
      return
    } catch {
      if (!video.muted) {
        video.muted = true
        setMuted(true)
        try {
          await video.play()
          return
        } catch {
          // Try a compatible preview below when the original stream cannot start.
        }
      }
    }
    if (!playbackUrl?.startsWith('file:')) void prepareCompatiblePreview()
  }

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current
    if (!video || preparing) return
    if (video.paused) {
      autoPlayPendingRef.current = false
      await startPlayback(video)
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
          <div className="lab-viewer-media">
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

            <div className="lab-viewer-stage ui-video-controls-host">
              {take.kind === 'video' ? (
                <>
                  <video
                    key={`${take.id}:${playbackUrl}`}
                    ref={videoRef}
                    src={playbackUrl ?? undefined}
                    muted={muted}
                    autoPlay
                    playsInline
                    preload="metadata"
                    onClick={() => void togglePlayback()}
                    onLoadedMetadata={(event) => {
                      setDuration(event.currentTarget.duration || 0)
                    }}
                    onCanPlay={(event) => {
                      setWaiting(false)
                      setPlaybackError(null)
                      if (!autoPlayPendingRef.current) return
                      autoPlayPendingRef.current = false
                      if (event.currentTarget.paused) void startPlayback(event.currentTarget)
                    }}
                    onWaiting={() => setWaiting(true)}
                    onPlaying={() => { setPlaying(true); setWaiting(false) }}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onEnded={() => {
                      setPlaying(false)
                      if (nextVideo) onSelectTake(nextVideo)
                    }}
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
                <img src={playbackUrl} alt={take.file_name} />
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

          <aside className="lab-viewer-shot-info" aria-label="镜头信息">
            <div className="lab-viewer-shot-heading">
              <span>镜头 {shot.order}</span>
              <h3>{shot.name}</h3>
            </div>
            {shot.visual_description.trim() && (
              <section className="lab-viewer-shot-section">
                <span>画面说明</span>
                <p>{shot.visual_description}</p>
              </section>
            )}
            {shot.movement_description.trim() && (
              <section className="lab-viewer-shot-section">
                <span>运镜说明</span>
                <p>{shot.movement_description}</p>
              </section>
            )}
            {shot.duration_ms > 0 && (
              <div className="lab-viewer-shot-duration">
                <Clock3 size={14} />
                <span>建议时长 {Math.round(shot.duration_ms / 1000)} 秒</span>
              </div>
            )}
          </aside>
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
