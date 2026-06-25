import type { RefObject } from 'react'
import { FileQuestion, Film, Play } from 'lucide-react'

import type { LunaFile } from '../shared/types'

interface PreviewThumbnailStripProps {
  activeThumbRef: RefObject<HTMLButtonElement>
  currentFileId: string
  files: LunaFile[]
  stripRef: RefObject<HTMLDivElement>
  onFileChange: (file: LunaFile) => void
}

function thumbnailSrcFor(file: LunaFile): string | null {
  return file.thumbnailUrl ?? null
}

export function PreviewThumbnailStrip({
  activeThumbRef,
  currentFileId,
  files,
  stripRef,
  onFileChange,
}: PreviewThumbnailStripProps) {
  return (
    <div className="preview-thumbnails" ref={stripRef}>
      {files.map((file) => {
        const isActive = file.id === currentFileId
        const thumbSrc = thumbnailSrcFor(file)
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
