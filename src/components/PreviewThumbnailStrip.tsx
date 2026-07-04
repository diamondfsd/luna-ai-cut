import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { FileQuestion, Film } from 'lucide-react'

import type { LunaFile } from '../shared/types'
import { VideoPlayBadge } from '../ui'
import { logger } from '../lib/rendererLogger'
import { filePathToLunaFile } from './previewModalUtils'
import { useLivePhotoWhenVisible } from '../shared/livePhoto'

interface PreviewThumbnailStripProps {
  filePathList: string[]
  initialFilePath?: string
  /** 已修改（调色/水印有变更）的文件 ID 集合 */
  modifiedFileIds?: Set<string>
  /** 当前选中文件变化时回调 */
  onChange?: (filePath: string) => void
}

function thumbnailSrcFor(file: LunaFile, resolvedMap: Record<string, string>): string | null {
  const resolved = resolvedMap[file.id]
  if (resolved) return resolved
  return file.thumbnailUrl ?? null
}

function ThumbnailItem({ file, isActive, isModified, resolvedMap, onFileChange, onThumbnailResolved, activeThumbRef }: {
  file: LunaFile
  isActive: boolean
  isModified: boolean
  resolvedMap: Record<string, string>
  onFileChange: (file: LunaFile) => void
  onThumbnailResolved: (fileId: string, url: string) => void
  activeThumbRef?: RefObject<HTMLButtonElement>
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const requestedRef = useRef(false)
  const isLive = useLivePhotoWhenVisible(file.href, btnRef, '200px')
  const thumbSrc = thumbnailSrcFor(file, resolvedMap)
  const showThumb = Boolean(thumbSrc)

  // 进入视口时请求缩略图
  useEffect(() => {
    if (requestedRef.current) return
    const el = btnRef.current
    if (!el) return

    if (showThumb) { requestedRef.current = true; return }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          requestedRef.current = true
          observer.disconnect()
          const localPath = file.downloadFilePath ?? file.localPath
          if (localPath) {
            window.luna.resolveThumbnail(localPath, file.kind).then((url) => {
              if (url) onThumbnailResolved(file.id, url)
            }).catch(() => {
              logger.warn('[缩略图条] resolveThumbnail 失败', { fileId: file.id, fileName: file.name })
            })
          } else {
            window.luna.cacheFile(file).then((ok) => {
              if (!ok) logger.warn('[缩略图条] cacheFile 返回 false', { fileId: file.id, fileName: file.name })
            }).catch(() => {
              logger.warn('[缩略图条] cacheFile 异常', { fileId: file.id, fileName: file.name })
            })
          }
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [file.href, showThumb])

  return (
    <button
      ref={(el) => {
        (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
        if (isActive && activeThumbRef) {
          ;(activeThumbRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
        }
      }}
      className={`preview-thumb-item${isActive ? ' active' : ''}${isModified ? ' modified' : ''}`}
      onClick={() => onFileChange(file)}
      title={file.name}
    >
      {isModified && <span className="preview-thumb-modified-dot" />}
      {showThumb ? (
        <img src={thumbSrc ?? undefined} alt={file.name} loading="lazy" />
      ) : (
        <span className="preview-thumb-placeholder">
          {file.kind === 'video' ? <Film size={14} /> : <FileQuestion size={14} />}
        </span>
      )}
      {file.kind === 'video' && <VideoPlayBadge size={16} />}
      {isLive && (
        <span className="preview-thumb-live">
          <span /><span /><span />
        </span>
      )}
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

  // ── 文件列表（内部转为 LunaFile） ──
  const files = useMemo(() => filePathList.map((p) => filePathToLunaFile(p)), [filePathList]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 当前选中索引 ──
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (initialFilePath) {
      const idx = filePathList.indexOf(initialFilePath)
      if (idx >= 0) return idx
    }
    return 0
  })

  const currentFileId = files[currentIndex]?.id

  // 同步外部 initialFilePath
  useEffect(() => {
    if (!initialFilePath) return
    const idx = filePathList.indexOf(initialFilePath)
    if (idx >= 0 && idx !== currentIndex) {
      setCurrentIndex(idx)
    }
  }, [initialFilePath, filePathList]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 缩略图解析 ──
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  useEffect(() => {
    return window.luna.onThumbnailReady(({ fileId, thumbnailUrl }) => {
      if (thumbnailUrl) {
        setThumbnails((prev) => ({ ...prev, [fileId]: thumbnailUrl }))
      }
    })
  }, [])

  function handleThumbnailResolved(fileId: string, url: string): void {
    setThumbnails((prev) => ({ ...prev, [fileId]: url }))
  }

  // ── 点击切换 ──
  function handleFileClick(file: LunaFile): void {
    const idx = files.findIndex((x) => x.id === file.id)
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
      {files.map((file) => (
        <ThumbnailItem
          key={file.id}
          file={file}
          isActive={file.id === currentFileId}
          isModified={modifiedFileIds?.has(file.id) ?? false}
          resolvedMap={thumbnails}
          onFileChange={handleFileClick}
          onThumbnailResolved={handleThumbnailResolved}
          activeThumbRef={file.id === currentFileId ? activeThumbRef : undefined}
        />
      ))}
    </div>
  )
}
