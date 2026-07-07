import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { Check, FileQuestion, FolderOpen, X } from 'lucide-react'
import type { DownloadProgress, LunaFile } from '../shared/types'
import { IconButton, LivePhotoBadge, VideoPlayBadge } from '../ui'
import { useLivePhotoWhenVisible } from '../shared/livePhoto'
import { useFileCache } from '../hooks/useFileCache'

const THUMBNAIL_PLACEHOLDER =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"%3E%3Crect width="400" height="300" fill="%23f4f2ee"/%3E%3Cpath d="M168 116h64a16 16 0 0 1 16 16v36a16 16 0 0 1-16 16h-64a16 16 0 0 1-16-16v-36a16 16 0 0 1 16-16Z" fill="none" stroke="%23948f87" stroke-width="10"/%3E%3Ccircle cx="180" cy="142" r="10" fill="%23948f87"/%3E%3Cpath d="m164 174 34-32 20 19 16-14 18 27" fill="none" stroke="%23948f87" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/%3E%3C/svg%3E'

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
}

function thumbnailPlaceholderFor(file: LunaFile): string {
  return `${THUMBNAIL_PLACEHOLDER}#${encodeURIComponent(file.downloadName || file.name || file.id)}`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
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
}: MediaCardProps) {
  const cardRef = useRef<HTMLElement>(null)
  const visibilityFiredRef = useRef(false)
  const [cacheEnabled, setCacheEnabled] = useState(false)

  // 视口可见时启用缓存
  useEffect(() => {
    if (visibilityFiredRef.current) return
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          visibilityFiredRef.current = true
          setCacheEnabled(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [file.id])

  // 根据 sourceUrl 获取缓存文件和缩略图
  const { thumbnailUrl, cacheFilePath, hasError } = useFileCache(file.sourceUrl, cacheEnabled)

  // 视频时长：优先用 file.duration，没有则异步探测
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  useEffect(() => {
    if (!cacheEnabled || file.kind !== 'video' || file.duration != null) return
    const filePath = file.downloadFilePath ?? file.localPath ?? cacheFilePath ?? file.sourceUrl
    if (!filePath) return

    window.luna.requestVideoFrameRate(file, filePath).catch(() => {})
    const unsub = window.luna.onVideoFrameRateReady((data) => {
      if (data.fileId === file.id && data.duration != null) {
        setVideoDuration(data.duration)
      }
    })
    return () => { unsub() }
  }, [cacheEnabled, file.id, file.kind, file.duration, file.downloadFilePath, file.localPath, cacheFilePath, file.sourceUrl])

  const effectiveDuration = file.duration ?? videoDuration

  const progressValue = progress?.status === 'done' || progress?.status === 'exists' ? 100 : progress?.percent ?? 0
  const progressStyle = { '--progress': `${progressValue * 3.6}deg` } as CSSProperties
  const localPath = file.downloadFilePath ?? file.localPath
  const downloadedPath = !selected ? localPath : undefined
  const thumbnailSource = thumbnailUrl ?? file.thumbnailUrl ?? thumbnailPlaceholderFor(file)
  const liveDetectSource = file.downloadFilePath ?? file.localPath ?? cacheFilePath ?? file.sourceUrl ?? file.url ?? file.href
  const showProgress = Boolean(
    progress && ['queued', 'downloading', 'failed'].includes(progress.status) && !downloadedPath,
  )
  const detectedLive = useLivePhotoWhenVisible(liveDetectSource, cardRef, '300px')
  const isLive = file.isLivePhoto || detectedLive

  return (
    <article ref={cardRef} className={selected ? 'media-card selected' : 'media-card'} data-file-id={file.id}>
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
      {isDownloadsPage ? (
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
        title="预览"
      >
        {!hasError && (
          <img
            src={thumbnailSource}
            alt={file.name}
            loading="lazy"
          />
        )}
        {hasError && <FileQuestion size={34} />}
        {file.kind === 'video' && effectiveDuration != null ? (
          <span className="duration-badge">{formatDuration(effectiveDuration)}</span>
        ) : isLive ? (
          <LivePhotoBadge size={28} className="card-live-chip" />
        ) : null}
        {file.kind === 'video' && <VideoPlayBadge size={26} />}
      </div>
    </article>
  )
}
