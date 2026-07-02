import { useEffect, useRef, useState, type RefObject } from 'react'
import { FileQuestion, Film, Play } from 'lucide-react'

import type { LunaFile } from '../shared/types'

interface PreviewThumbnailStripProps {
  activeThumbRef: RefObject<HTMLButtonElement>
  currentFileId: string
  files: LunaFile[]
  stripRef: RefObject<HTMLDivElement>
  onFileChange: (file: LunaFile) => void
}

function thumbnailSrcFor(file: LunaFile, resolvedMap: Record<string, string>): string | null {
  // 优先使用 IPC 已解析的缩略图
  const resolved = resolvedMap[file.id]
  if (resolved) return resolved
  // 图片可直接用 file://；视频走 IPC 解析
  if (file.kind === 'video' || file.kind === 'lrv') return null
  return file.thumbnailUrl ?? null
}

export function PreviewThumbnailStrip({
  activeThumbRef,
  currentFileId,
  files,
  stripRef,
  onFileChange,
}: PreviewThumbnailStripProps) {
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const requestedRef = useRef<Set<string>>(new Set())

  // 异步解析视频缩略图（检查缓存 → 生成 → 展示）
  useEffect(() => {
    for (const file of files) {
      if (file.kind !== 'video' && file.kind !== 'lrv') continue
      if (requestedRef.current.has(file.id)) continue
      requestedRef.current.add(file.id)

      const localPath = file.downloadFilePath ?? file.localPath
      if (!localPath) continue

      window.luna.resolveThumbnail(localPath, file.kind).then((url) => {
        if (url) {
          setThumbnails((prev) => ({ ...prev, [file.id]: url }))
        }
      }).catch(() => { /* 缩略图生成失败，保持图标占位 */ })
    }
  }, [files])

  return (
    <div className="preview-thumbnails" ref={stripRef}>
      {files.map((file) => {
        const isActive = file.id === currentFileId
        const thumbSrc = thumbnailSrcFor(file, thumbnails)
        return (
          <button
            key={file.id}
            ref={isActive ? activeThumbRef : undefined}
            className={`preview-thumb-item${isActive ? ' active' : ''}`}
            onClick={() => onFileChange(file)}
            title={file.name}
          >
            {thumbSrc ? (
              <img src={thumbSrc} alt={file.name} loading="lazy" />
            ) : (
              <span className="preview-thumb-placeholder">
                {file.kind === 'video' ? <Film size={14} /> : <FileQuestion size={14} />}
              </span>
            )}
            {file.kind === 'video' && (
              <span className="preview-thumb-badge">
                <Play size={8} fill="currentColor" />
              </span>
            )}
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
