import { useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion } from 'lucide-react'

import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import type { LunaFile } from '../shared/types'

interface MediaPreviewPanelProps {
  files: LunaFile[]
  currentFile: LunaFile
  displaySource: string | null
  onFileChange: (file: LunaFile) => void
}

export function MediaPreviewPanel({
  files,
  currentFile,
  displaySource,
  onFileChange,
}: MediaPreviewPanelProps) {
  const thumbStripRef = useRef<HTMLDivElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const currentFileId = currentFile.id

  const [hasPrevious, hasNext] = useMemo(() => {
    const idx = files.findIndex((f) => f.id === currentFileId)
    return [idx > 0, idx >= 0 && idx < files.length - 1]
  }, [files, currentFileId])

  function navigateFile(direction: -1 | 1): void {
    const idx = files.findIndex((f) => f.id === currentFileId)
    if (idx < 0) return
    const next = idx + direction
    if (next < 0 || next >= files.length) return
    onFileChange(files[next])
  }

  return (
    <div className="preview-stage-col">
      <div className="preview-stage" ref={stageRef}>
        {currentFile.kind === 'image' && displaySource ? (
          <div className="preview-media-wrapper">
            <div className="preview-media-inner">
              <img
                ref={imgRef}
                src={displaySource}
                alt={currentFile.name}
                style={{ maxWidth: '100%', maxHeight: '100%', display: 'block', width: 'auto', height: 'auto' }}
              />
            </div>
          </div>
        ) : currentFile.kind === 'video' && displaySource ? (
          <div className="preview-media-wrapper">
            <div className="preview-media-inner">
              <video
                src={displaySource}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
              />
            </div>
          </div>
        ) : (
          <div className="unknown-preview">
            <FileQuestion size={48} />
            <span>无法预览</span>
          </div>
        )}

        {hasPrevious && (
          <button className="preview-nav previous" onClick={() => navigateFile(-1)} title="上一个">
            <ChevronLeft size={24} />
          </button>
        )}
        {hasNext && (
          <button className="preview-nav next" onClick={() => navigateFile(1)} title="下一个">
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      <PreviewThumbnailStrip
        activeThumbRef={activeThumbRef}
        currentFileId={currentFileId}
        files={files}
        stripRef={thumbStripRef}
        onFileChange={onFileChange}
      />
    </div>
  )
}
