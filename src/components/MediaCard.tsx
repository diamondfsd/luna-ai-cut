import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, X } from 'lucide-react'
import type { DownloadProgress, LunaFile } from '../shared/types'
import { IconButton, LivePhotoBadge, VideoPlayBadge } from '../ui'
import { useLivePhotoWhenVisible } from '../shared/livePhoto'
import { ThumbImage } from './ThumbImage'
import dolbyVisionLogo from '../assets/logos/dolby-vision-vertical.png'
import '../styles/media-card-format-badge.css'

const LIVE_DETECT_ROOT_MARGIN = '0px 0px 300px 0px'

interface MediaCardProps {
  file: LunaFile
  isDownloadsPage: boolean
  selected: boolean
  progress: DownloadProgress | undefined
  selectVisible: boolean
  onToggle: (file: LunaFile) => void
  onPreview: (file: LunaFile) => void
  onRevealPath: (path: string) => void
  onRevealProgress: (progress: DownloadProgress | undefined) => void
  selectionOnly?: boolean
  overlay?: ReactNode
  className?: string
  previewTitle?: string
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return h > 0
    ? `${h}:${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export function MediaCard({
  file,
  isDownloadsPage,
  selected,
  progress,
  selectVisible,
  onToggle,
  onPreview,
  onRevealPath,
  onRevealProgress,
  selectionOnly = false,
  overlay,
  className,
  previewTitle = '预览',
}: MediaCardProps) {
  const cardRef = useRef<HTMLElement>(null)

  // 视频时长：优先用文件数据；缩略图缓存就绪后再异步补全。
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [detectedDolbyVision, setDetectedDolbyVision] = useState<boolean | null>(null)
  const [detectedDolbyVisionProfile, setDetectedDolbyVisionProfile] = useState<number | null>(null)
  const [detectedILog, setDetectedILog] = useState<boolean | null>(null)
  useEffect(() => {
    if (file.kind !== 'video') return
    const unsub = window.luna.onVideoFrameRateReady((data) => {
      if (data.fileId === file.id && data.duration != null) {
        setVideoDuration(data.duration)
      }
      if (data.fileId === file.id && data.dolbyVision != null) {
        setDetectedDolbyVision(data.dolbyVision)
        setDetectedDolbyVisionProfile(data.dolbyVisionProfile ?? null)
      }
      if (data.fileId === file.id && data.iLog != null) {
        setDetectedILog(data.iLog)
      }
    })
    return () => { unsub() }
  }, [file.id, file.kind])

  const handleCacheReady = useCallback((cacheFilePath: string) => {
    if (file.kind !== 'video' || (file.duration != null && file.dolbyVision != null && file.iLog != null)) return
    void window.luna.requestVideoFrameRate(file, cacheFilePath).catch(() => {})
  }, [file])

  const effectiveDuration = file.duration ?? videoDuration
  const isDolbyVision = file.dolbyVision ?? detectedDolbyVision ?? false
  const dolbyVisionProfile = file.dolbyVisionProfile ?? detectedDolbyVisionProfile
  const isILog = file.iLog ?? detectedILog ?? false

  const progressValue = progress?.status === 'done' || progress?.status === 'exists' ? 100 : progress?.percent ?? 0
  const progressStyle = { '--progress': `${progressValue * 3.6}deg` } as CSSProperties
  const localPath = file.downloadFilePath ?? file.localPath
  const downloadedPath = localPath
  const liveDetectSource = file.downloadFilePath ?? file.localPath ?? file.sourceUrl ?? file.url ?? file.href
  const showProgress = Boolean(
    progress && ['queued', 'downloading', 'failed'].includes(progress.status) && !downloadedPath,
  )
  const detectedLive = useLivePhotoWhenVisible(liveDetectSource, cardRef, LIVE_DETECT_ROOT_MARGIN)
  const isLive = file.isLivePhoto || detectedLive

  return (
    <article ref={cardRef} className={['media-card', selected && 'selected', className].filter(Boolean).join(' ')} data-file-id={file.id}>
      {showProgress && progress && (
        <button
          className={`download-state ${progress.status}`}
          onClick={() => onRevealProgress(progress)}
          disabled={progress.status !== 'done'}
          style={progressStyle}
          title={progress.status === 'queued' ? '等待下载' : progress.status === 'failed' ? '下载失败' : '下载进度'}
        >
          {progress.status === 'failed' ? <X size={14} /> : null}
          {progress.status === 'queued' || progress.status === 'downloading' ? <span>{Math.round(progressValue)}%</span> : null}
        </button>
      )}
      {selectionOnly ? (
        <IconButton variant="ghost" className="select-chip" onClick={() => onToggle(file)} title="选择" aria-label={selected ? `取消选择 ${file.name}` : `选择 ${file.name}`} icon={selected ? <Check size={15} /> : undefined} />
      ) : isDownloadsPage ? (
        <>
          {localPath && (
            <IconButton variant="light" className="downloaded-folder-btn" onClick={() => onRevealPath(localPath)} title="在文件夹中显示" icon={<FolderOpen size={14} />} />
          )}
          <IconButton variant="ghost" className="select-chip" onClick={() => onToggle(file)} title="选择" icon={selected ? <Check size={15} /> : undefined} />
        </>
      ) : downloadedPath ? (
        <IconButton variant="light" className="downloaded-folder-btn" onClick={() => onRevealPath(downloadedPath)} title="在文件夹中显示" icon={<FolderOpen size={14} />} />
      ) : (
        selectVisible && (
          <IconButton variant="ghost" className="select-chip" onClick={() => onToggle(file)} title="选择" icon={selected ? <Check size={15} /> : undefined} />
        )
      )}
      <div
        className="media-frame"
        onClick={() => onPreview(file)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onPreview(file)
          }
        }}
        role="button"
        tabIndex={0}
        title={previewTitle}
      >
        <ThumbImage
          src={file.previewUrl || file.sourceUrl}
          preloadBottom={300}
          alt={file.name}
          onCacheReady={handleCacheReady}
        />
        {file.kind === 'video' && effectiveDuration != null ? (
          <span className="duration-badge">{formatDuration(effectiveDuration)}</span>
        ) : isLive ? (
          <LivePhotoBadge size={28} className="card-live-chip" />
        ) : null}
        {isDolbyVision ? (
          <span className="video-format-badge dolby-vision-badge" title={dolbyVisionProfile ? `杜比视界 Profile ${dolbyVisionProfile}` : '杜比视界'}>
            <img src={dolbyVisionLogo} alt="Dolby Vision" />
          </span>
        ) : isILog ? (
          <span className="video-format-badge i-log-badge" title="I-Log">I-LOG</span>
        ) : null}
        {file.rawCompanion && (
          <span className="video-format-badge raw-badge" title="包含 RAW 原始文件">RAW</span>
        )}
        {file.kind === 'video' && !isDolbyVision && !isILog && <VideoPlayBadge size={26} />}
        {overlay}
      </div>
    </article>
  )
}
