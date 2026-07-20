import { FileQuestion } from 'lucide-react'
import { useRef, useState } from 'react'

import { MediaCard } from './MediaCard'
import { useMediaLib } from '../pages/useMediaLibraryController'
import { Button, LoadingIndicator } from '../ui'

interface MediaGalleryProps {
  mode: 'camera' | 'local'
  groupTitle: (group: string) => string
}

export function MediaGallery({ mode, groupTitle }: MediaGalleryProps) {
  const ctrl = useMediaLib()
  const { downloadProgress } = ctrl
  const isLocal = mode === 'local'
  const galleryRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.media-card, .section-actions')) return
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    galleryRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    const gallery = galleryRef.current
    if (!gallery) return

    const rect = gallery.getBoundingClientRect()
    const left = Math.min(dragStartRef.current.x, e.clientX) - rect.left + gallery.scrollLeft
    const top = Math.min(dragStartRef.current.y, e.clientY) - rect.top + gallery.scrollTop
    const width = Math.abs(e.clientX - dragStartRef.current.x)
    const height = Math.abs(e.clientY - dragStartRef.current.y)
    setDragRect({ left, top, width, height })

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

  function handlePointerUp(): void {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragRect(null)

    const gallery = galleryRef.current
    if (!gallery) return

    const dragSelectedIds = new Set<string>()
    const cards = gallery.querySelectorAll<HTMLElement>('.media-card.drag-selected')
    for (const card of cards) {
      dragSelectedIds.add(card.dataset.fileId ?? '')
      card.classList.remove('drag-selected')
    }

    if (dragSelectedIds.size > 0) {
      const toggled = new Set(ctrl.selected)
      for (const id of dragSelectedIds) {
        if (toggled.has(id)) toggled.delete(id)
        else toggled.add(id)
      }
      ctrl.setSelected(toggled)
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
      {ctrl.isCurrentLoading && (
        <section className="loading-gallery">
          <LoadingIndicator size="large" label={isLocal ? '正在读取已下载文件' : '正在读取 Luna 媒体'} />
        </section>
      )}
      {ctrl.groups.map(([group, items]) => (
        <section
          className="media-section"
          data-group={group}
          key={group}
        >
          <div className="section-heading">
            <h2>{groupTitle(group)}</h2>
            <div className="section-actions">
              <span className="file-count-chip">{items.length} 个文件</span>
              <Button variant="secondary" size="compact" onClick={() => ctrl.toggleGroup(items)}>
                {items.every((file) => ctrl.selected.has(file.id)) ? '取消选择' : '选择'}
              </Button>
            </div>
          </div>

          <div className={`media-grid card-size-${ctrl.cardSize}`}>
            {items.map((file) => {
              const isSelected = ctrl.selected.has(file.id)
              const progress = downloadProgress.get(file.name)
              const localPath = file.downloadFilePath ?? file.localPath
              return (
                <MediaCard
                  key={file.id}
                  file={file}
                  isDownloadsPage={isLocal}
                  selected={isSelected}
                  progress={progress}
                  selectVisible={!progress || !['queued', 'downloading', 'failed'].includes(progress.status) || Boolean(localPath && isSelected)}
                  onToggle={ctrl.toggleFile}
                  onPreview={ctrl.handlePreviewClick}
                  onRevealPath={ctrl.revealFileByPath}
                  onRevealProgress={ctrl.revealDownloadedFile}
                />
              )
            })}
          </div>
        </section>
      ))}
      {!ctrl.isCurrentLoading && ctrl.filteredFiles.length === 0 && (
        <section className="empty-gallery">
          <FileQuestion size={42} />
          <span>{isLocal ? '暂无已下载' : '暂无媒体'}</span>
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
