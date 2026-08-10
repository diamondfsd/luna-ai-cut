import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'

import { LivePhotoBadge, VideoPlayBadge } from '../ui'
import { useLivePhotoWhenVisible } from '../shared/livePhoto'
import { fileNameFromPath, mediaKindFromPath } from '../lib/fileUtils'
import { ThumbImage } from './ThumbImage'
import './PreviewThumbnailStrip.css'

interface PreviewThumbnailStripProps {
  filePathList: string[]
  initialFilePath?: string
  /** 已修改（调色/水印有变更）的文件 ID 集合 */
  modifiedFileIds?: Set<string>
  /** 当前选中文件变化时回调 */
  onChange?: (filePath: string) => void
}

function localPathForDuration(cacheFilePath: string): string {
  if (!cacheFilePath.startsWith('file:')) return cacheFilePath
  try {
    const localPath = decodeURIComponent(new URL(cacheFilePath).pathname)
    return /^\/[a-zA-Z]:\//.test(localPath) ? localPath.slice(1) : localPath
  } catch {
    return cacheFilePath
  }
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

function ThumbnailItem({ filePath, isActive, isModified, onFileChange, activeThumbRef }: {
  filePath: string
  isActive: boolean
  isModified: boolean
  onFileChange: (filePath: string) => void
  activeThumbRef?: RefObject<HTMLButtonElement | null>
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const kind = mediaKindFromPath(filePath)
  const isLive = useLivePhotoWhenVisible(filePath, btnRef, '200px')
  const durationRequestPathRef = useRef<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)

  const handleCacheReady = useCallback((cacheFilePath: string) => {
    if (kind !== 'video') return
    const localPath = localPathForDuration(cacheFilePath)
    if (durationRequestPathRef.current === localPath) return
    durationRequestPathRef.current = localPath
    void window.luna.workspace.getVideoDuration(localPath)
      .then(setDuration)
      .catch(() => setDuration(null))
  }, [kind])

  return (
    <button
      ref={(el) => {
        (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
        if (isActive && activeThumbRef) {
          (activeThumbRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
        }
      }}
      className={`preview-thumb-item${isActive ? ' active' : ''}${isModified ? ' modified' : ''}`}
      onClick={() => onFileChange(filePath)}
      title={fileNameFromPath(filePath)}
    >
      {isModified && <span className="preview-thumb-modified-dot" />}
      <ThumbImage
        src={filePath}
        alt={fileNameFromPath(filePath)}
        loading="lazy"
        onCacheReady={handleCacheReady}
      />
      {kind === 'video' && duration != null && <span className="preview-thumb-duration">{formatDuration(duration)}</span>}
      {kind === 'video' && <VideoPlayBadge size={16} />}
      {isLive && <LivePhotoBadge size={18} className="preview-thumb-live" />}
    </button>
  )
}

export function PreviewThumbnailStrip({
  filePathList,
  initialFilePath,
  modifiedFileIds,
  onChange,
}: PreviewThumbnailStripProps) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const activeThumbRef = useRef<HTMLButtonElement | null>(null)

  const files = useMemo(() => filePathList, [filePathList])

  // ── 当前选中索引 ──
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (initialFilePath) {
      const idx = filePathList.indexOf(initialFilePath)
      if (idx >= 0) return idx
    }
    return 0
  })

  const currentFilePath = files[currentIndex]

  // 同步外部 initialFilePath
  useEffect(() => {
    if (!initialFilePath) return
    const idx = filePathList.indexOf(initialFilePath)
    if (idx >= 0 && idx !== currentIndex) {
      setCurrentIndex(idx)
    }
  }, [initialFilePath, filePathList]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 点击切换 ──
  function handleFileClick(filePath: string): void {
    const idx = files.indexOf(filePath)
    if (idx >= 0 && idx !== currentIndex) {
      setCurrentIndex(idx)
    }
  }

  // ── 键盘导航 ──
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  const filePathListLengthRef = useRef(filePathList.length)
  useEffect(() => { filePathListLengthRef.current = filePathList.length })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCurrentIndex((prev) => {
          const next = prev - 1
          return next < 0 ? prev : next
        })
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        setCurrentIndex((prev) => {
          const next = prev + 1
          return next >= filePathListLengthRef.current ? prev : next
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // ── currentIndex 变化时通知父级 ──
  const isFirstIndexChange = useRef(true)
  useEffect(() => {
    if (isFirstIndexChange.current) {
      isFirstIndexChange.current = false
      return
    }
    onChangeRef.current?.(filePathList[currentIndex])
  }, [currentIndex, filePathList])

  // ── 当前缩略图滚动到可视区域 ──
  useEffect(() => {
    if (activeThumbRef.current) {
      activeThumbRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
    }
  }, [currentIndex])

  return (
    <div className="preview-thumbnails" ref={stripRef}>
      {files.map((filePath) => (
        <ThumbnailItem
          key={filePath}
          filePath={filePath}
          isActive={filePath === currentFilePath}
          isModified={modifiedFileIds?.has(filePath) ?? false}
          onFileChange={handleFileClick}
          activeThumbRef={filePath === currentFilePath ? activeThumbRef : undefined}
        />
      ))}
    </div>
  )
}
