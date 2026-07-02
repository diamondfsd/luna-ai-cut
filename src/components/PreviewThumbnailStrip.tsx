import { useEffect, useRef, useState, type RefObject } from 'react'
import { FileQuestion, Film } from 'lucide-react'

import type { LunaFile } from '../shared/types'
import { VideoPlayBadge } from '../ui'
import { logger } from '../lib/rendererLogger'

interface PreviewThumbnailStripProps {
  activeThumbRef: RefObject<HTMLButtonElement>
  currentFileId: string
  files: LunaFile[]
  stripRef: RefObject<HTMLDivElement>
  onFileChange: (file: LunaFile) => void
  /** 已修改（调色/水印有变更）的文件 ID 集合 */
  modifiedFileIds?: Set<string>
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
  const thumbSrc = thumbnailSrcFor(file, resolvedMap)
  const showThumb = Boolean(thumbSrc)

  // 进入视口时才请求缩略图
  useEffect(() => {
    if (showThumb || requestedRef.current) return
    const el = btnRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          requestedRef.current = true
          observer.disconnect()
          const localPath = file.downloadFilePath ?? file.localPath
          if (localPath) {
            // 有本地文件 → resolveThumbnail 直接生成缩略图
            window.luna.resolveThumbnail(localPath, file.kind).then((url) => {
              if (url) onThumbnailResolved(file.id, url)
            }).catch(() => {
              logger.warn('[缩略图条] resolveThumbnail 失败', { fileId: file.id, fileName: file.name })
            })
          } else {
            // 无本地路径（相机文件）→ cacheFile 先下载再生成缩略图
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
  }, [file.id, showThumb])

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
      {file.isLivePhoto && (
        <span className="preview-thumb-live">
          <span /><span /><span />
        </span>
      )}
    </button>
  )
}

export function PreviewThumbnailStrip({
  activeThumbRef,
  currentFileId,
  files,
  stripRef,
  onFileChange,
  modifiedFileIds,
}: PreviewThumbnailStripProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})

  // 监听 onThumbnailReady，实时同步缩略图
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

  return (
    <div className="preview-thumbnails" ref={stripRef}>
      {files.map((file) => (
        <ThumbnailItem
          key={file.id}
          file={file}
          isActive={file.id === currentFileId}
          isModified={modifiedFileIds?.has(file.id) ?? false}
          resolvedMap={thumbnails}
          onFileChange={onFileChange}
          onThumbnailResolved={handleThumbnailResolved}
          activeThumbRef={file.id === currentFileId ? activeThumbRef : undefined}
        />
      ))}
    </div>
  )
}
