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
  // 优先使用 IPC 已解析/更新的缩略图
  const resolved = resolvedMap[file.id]
  if (resolved) return resolved
  // 回退到已有的 thumbnailUrl
  return file.thumbnailUrl ?? null
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
  const requestedRef = useRef<Set<string>>(new Set())

  // 对所有无缩略图的文件（图片和视频）主动请求缩略图
  useEffect(() => {
    for (const file of files) {
      // 已有缩略图则跳过
      if (thumbnails[file.id] || file.thumbnailUrl) continue
      if (requestedRef.current.has(file.id)) continue
      requestedRef.current.add(file.id)

      const localPath = file.downloadFilePath ?? file.localPath
      if (!localPath) continue

      window.luna.resolveThumbnail(localPath, file.kind).then((url) => {
        if (url) {
          setThumbnails((prev) => ({ ...prev, [file.id]: url }))
        }
      }).catch(() => {
        logger.warn(`[缩略图条] resolveThumbnail 失败`, { fileId: file.id, fileName: file.name, kind: file.kind })
      })
    }
  }, [files, thumbnails])

  // 监听 onThumbnailReady，实时同步缩略图（主库 cacheFile 完成后推送）
  useEffect(() => {
    return window.luna.onThumbnailReady(({ fileId, thumbnailUrl }) => {
      if (thumbnailUrl) {
        setThumbnails((prev) => ({ ...prev, [fileId]: thumbnailUrl }))
      }
    })
  }, [])

  return (
    <div className="preview-thumbnails" ref={stripRef}>
      {files.map((file) => {
        const isActive = file.id === currentFileId
        const thumbSrc = thumbnailSrcFor(file, thumbnails)
        const isModified = modifiedFileIds?.has(file.id)
        return (
          <button
            key={file.id}
            ref={isActive ? activeThumbRef : undefined}
            className={`preview-thumb-item${isActive ? ' active' : ''}${isModified ? ' modified' : ''}`}
            onClick={() => onFileChange(file)}
            title={file.name}
          >
            {isModified && <span className="preview-thumb-modified-dot" />}
            {thumbSrc ? (
              <img src={thumbSrc} alt={file.name} loading="lazy" />
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
      })}
    </div>
  )
}
