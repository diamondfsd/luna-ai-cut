import { useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, FileQuestion } from 'lucide-react'

import { PreviewThumbnailStrip } from './PreviewThumbnailStrip'
import { WatermarkOverlay } from './WatermarkOverlay'
import type { LunaFile, WatermarkSettings } from '../shared/types'

interface MediaPreviewPanelProps {
  /** 文件列表 */
  files: LunaFile[]
  /** 当前文件 */
  currentFile: LunaFile
  /** 当前文件的预览 URL */
  displaySource: string | null
  /** 文件切换回调 */
  onFileChange: (file: LunaFile) => void
  /** 水印覆盖层设置（可选，传此值即显示水印） */
  watermarkSettings?: WatermarkSettings
}

/**
 * 媒体预览面板。
 *
 * 封装了预览 stage（图片/视频展示 + 导航按钮）+ 缩略图条，
 * 用于 ExportModal 等需要简单预览能力的场景。
 *
 * 复杂的预览行为（缩放、拖拽、Live Photo）由 PreviewModal / PreviewStage 处理。
 */
export function MediaPreviewPanel({
  files,
  currentFile,
  displaySource,
  onFileChange,
  watermarkSettings,
}: MediaPreviewPanelProps) {
  const thumbStripRef = useRef<HTMLDivElement>(null)
  const activeThumbRef = useRef<HTMLButtonElement>(null)

  const currentFileId = currentFile.id
  const showWatermark = watermarkSettings !== undefined

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
      <div className="preview-stage">
        {currentFile.kind === 'image' && displaySource ? (
          <div className="preview-media-inner">
            <img
              src={displaySource}
              alt={currentFile.name}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
            {showWatermark && <WatermarkOverlay settings={watermarkSettings} kind="image" />}
          </div>
        ) : currentFile.kind === 'video' && displaySource ? (
          <div className="preview-media-inner">
            <video
              src={displaySource}
              controls
              autoPlay
              style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto' }}
            />
            {showWatermark && <WatermarkOverlay settings={watermarkSettings} kind="video" />}
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
