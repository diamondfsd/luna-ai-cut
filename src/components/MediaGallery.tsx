import { FileQuestion } from 'lucide-react'
import { useRef, useState } from 'react'

import { MediaCard } from './MediaCard'
import type { DownloadProgress, LunaFile } from '../shared/types'
import { Button, LoadingIndicator } from '../ui'

type CardSize = 'large' | 'medium' | 'small'

interface MediaGalleryProps {
  cacheFailedIds: Set<string>
  cardSize: CardSize
  downloadProgress: Map<string, DownloadProgress>
  filteredFiles: LunaFile[]
  groups: Array<[string, LunaFile[]]>
  isCurrentLoading: boolean
  isDownloadsPage: boolean
  selected: Set<string>
  selectedFiles: LunaFile[]
  selectMode?: boolean
  groupTitle: (group: string) => string
  handlePreviewClick: (file: LunaFile) => void
  handleThumbnailImageLoad: (file: LunaFile, localPath: string | null | undefined) => void
  onSelect?: (files: LunaFile[]) => void
  revealDownloadedFile: (progress: DownloadProgress | undefined) => void
  revealFileByPath: (path: string) => void
  toggleFile: (file: LunaFile) => void
  toggleGroup: (items: LunaFile[]) => void
  /** 拖拽框选回调 */
  onDragSelectionChange?: (fileIds: Set<string>) => void
}

export function MediaGallery({
  cacheFailedIds,
  cardSize,
  downloadProgress,
  filteredFiles,
  groups,
  isCurrentLoading,
  isDownloadsPage,
  selected,
  selectedFiles,
  selectMode,
  groupTitle,
  handlePreviewClick,
  handleThumbnailImageLoad,
  onSelect,
  revealDownloadedFile,
  revealFileByPath,
  toggleFile,
  toggleGroup,
  onDragSelectionChange,
}: MediaGalleryProps) {
  const galleryRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    // 卡片和操作按钮上不触发拖拽框选
    if ((e.target as HTMLElement).closest('.media-card, .section-actions')) return
    if (!onDragSelectionChange) return
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    galleryRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    const gallery = galleryRef.current
    if (!gallery) return

    const rect = gallery.getBoundingClientRect()
    const left = Math.min(dragStartRef.current.x, e.clientX) - rect.left
    const top = Math.min(dragStartRef.current.y, e.clientY) - rect.top
    const width = Math.abs(e.clientX - dragStartRef.current.x)
    const height = Math.abs(e.clientY - dragStartRef.current.y)
    setDragRect({ left, top, width, height })

    // 计算框选范围内的卡片，直接用 DOM 操作添加高亮 class（避免拖拽中频繁 re-render）
    const dragBounds = {
      left: Math.min(dragStartRef.current.x, e.clientX),
      right: Math.max(dragStartRef.current.x, e.clientX),
      top: Math.min(dragStartRef.current.y, e.clientY),
      bottom: Math.max(dragStartRef.current.y, e.clientY),
    }

    const cards = gallery.querySelectorAll<HTMLElement>('.media-card')
    for (const card of cards) {
      const cr = card.getBoundingClientRect()
      const overlaps =
        cr.left < dragBounds.right &&
        cr.right > dragBounds.left &&
        cr.top < dragBounds.bottom &&
        cr.bottom > dragBounds.top
      card.classList.toggle('drag-selected', overlaps)
    }
  }

  function handlePointerUp(_e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragRect(null)

    const gallery = galleryRef.current
    if (!gallery) return

    // 收集框选的卡片 ID
    const dragSelectedIds = new Set<string>()
    const cards = gallery.querySelectorAll<HTMLElement>('.media-card.drag-selected')
    for (const card of cards) {
      dragSelectedIds.add(card.dataset.fileId ?? '')
      card.classList.remove('drag-selected')
    }

    if (dragSelectedIds.size > 0 && onDragSelectionChange) {
      // 切换模式：已选中的移除，未选中的叠加
      const toggled = new Set(selected)
      for (const id of dragSelectedIds) {
        if (toggled.has(id)) toggled.delete(id)
        else toggled.add(id)
      }
      onDragSelectionChange(toggled)
    }
  }

  return (
    <div
      ref={galleryRef}
      className="gallery"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {isCurrentLoading && (
        <section className="loading-gallery">
          <LoadingIndicator size="large" label={isDownloadsPage ? '正在读取已下载文件' : '正在读取 Luna 媒体'} />
        </section>
      )}
      {groups.map(([group, items]) => (
        <section
          className="media-section"
          data-group={group}
          key={group}
        >
          <div className="section-heading">
            <h2>{groupTitle(group)}</h2>
            <div className="section-actions">
              <span className="file-count-chip">{items.length} 个文件</span>
              <Button variant="secondary" size="compact" onClick={() => toggleGroup(items)}>
                {items.every((file) => selected.has(file.id)) ? '取消选择' : '选择'}
              </Button>
              {selectMode && selectedFiles.length > 0 && (
                <Button variant="primary" size="compact" onClick={() => onSelect?.([...selectedFiles])}>
                  确认选择 ({selectedFiles.length})
                </Button>
              )}
            </div>
          </div>

          <div className={`media-grid card-size-${cardSize}`}>
            {items.map((file) => {
              const isSelected = selected.has(file.id)
              const progress = downloadProgress.get(file.name)
              const localPath = file.downloadFilePath ?? file.localPath
              return (
                <MediaCard
                  key={file.id}
                  file={file}
                  isDownloadsPage={isDownloadsPage}
                  selected={isSelected}
                  progress={progress}
                  cacheFailed={cacheFailedIds.has(file.id)}
                  selectVisible={!progress || !['queued', 'downloading', 'failed'].includes(progress.status) || Boolean(localPath && isSelected)}
                  onToggle={toggleFile}
                  onPreview={handlePreviewClick}
                  onRevealPath={revealFileByPath}
                  onRevealProgress={revealDownloadedFile}
                  onThumbnailLoad={handleThumbnailImageLoad}
                />
              )
            })}
          </div>
        </section>
      ))}
      {!isCurrentLoading && filteredFiles.length === 0 && (
        <section className="empty-gallery">
          <FileQuestion size={42} />
          <span>{isDownloadsPage ? '暂无已下载' : '暂无媒体'}</span>
        </section>
      )}

      {dragRect && (
        <div
          className="gallery-drag-select"
          style={{
            left: dragRect.left,
            top: dragRect.top,
            width: dragRect.width,
            height: dragRect.height,
          }}
        />
      )}
    </div>
  )
}
