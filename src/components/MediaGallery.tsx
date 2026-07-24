import { CalendarDays, FileQuestion, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { MediaCard } from './MediaCard'
import { useMediaLib } from '../pages/useMediaLibraryController'
import { Button, IconButton, LoadingIndicator } from '../ui'
import '../styles/media-date-navigation.css'

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
  const [dateNavCollapsed, setDateNavCollapsed] = useState(false)
  const [activeDateGroup, setActiveDateGroup] = useState<string | null>(ctrl.firstGroup)

  useEffect(() => {
    setActiveDateGroup(ctrl.firstGroup)
  }, [ctrl.firstGroup])

  useEffect(() => {
    const gallery = galleryRef.current
    if (!gallery || ctrl.groups.length === 0) return
    const sections = [...gallery.querySelectorAll<HTMLElement>('.media-section[data-group]')]
    let scrollParent: HTMLElement | null = gallery
    while (scrollParent) {
      const { overflowY } = window.getComputedStyle(scrollParent)
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scrollParent = scrollParent.parentElement
    }

    let frame = 0
    const updateActiveDate = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const anchor = (scrollParent?.getBoundingClientRect().top ?? 0) + (scrollParent === gallery ? 16 : 66)
        let active = sections[0]?.dataset.group ?? null
        for (const section of sections) {
          if (section.getBoundingClientRect().top > anchor) break
          active = section.dataset.group ?? active
        }
        setActiveDateGroup(active)
      })
    }

    updateActiveDate()
    const target: HTMLElement | Window = scrollParent ?? window
    target.addEventListener('scroll', updateActiveDate, { passive: true })
    window.addEventListener('resize', updateActiveDate)
    return () => {
      window.cancelAnimationFrame(frame)
      target.removeEventListener('scroll', updateActiveDate)
      window.removeEventListener('resize', updateActiveDate)
    }
  }, [ctrl.groups])

  function scrollToGroup(group: string): void {
    const section = [...(galleryRef.current?.querySelectorAll<HTMLElement>('.media-section[data-group]') ?? [])]
      .find((candidate) => candidate.dataset.group === group)
    if (!section) return
    setActiveDateGroup(group)
    section.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' })
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.media-card, .section-actions, .media-date-nav')) return
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
      className={`gallery${dateNavCollapsed ? ' date-nav-collapsed' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <aside className="media-date-nav" aria-label="日期导航">
        <div className="media-date-nav-header">
          {!dateNavCollapsed && <span><CalendarDays size={14} />日期</span>}
          <IconButton
            variant="ghost"
            size="mini"
            icon={dateNavCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            aria-label={dateNavCollapsed ? '展开日期导航' : '收起日期导航'}
            title={dateNavCollapsed ? '展开日期导航' : '收起日期导航'}
            onClick={() => setDateNavCollapsed((value) => !value)}
          />
        </div>
        {!dateNavCollapsed && <nav className="media-date-nav-list">
          {ctrl.groups.map(([group, items]) => (
            <Button
              key={group}
              variant="ghost"
              size="compact"
              className={`media-date-nav-item${activeDateGroup === group ? ' active' : ''}`}
              onClick={() => scrollToGroup(group)}
            >
              <span>{groupTitle(group)}</span>
              <strong>{items.length}</strong>
            </Button>
          ))}
        </nav>}
      </aside>
      <div className="media-gallery-content">
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
    </div>
  )
}
