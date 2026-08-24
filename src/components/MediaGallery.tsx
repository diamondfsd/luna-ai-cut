import { CalendarDays, FileQuestion, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { MediaCard } from './MediaCard'
import { useMediaLib } from '../pages/useMediaLibraryController'
import { Button, IconButton, LoadingIndicator } from '../ui'
import '../styles/media-date-navigation.css'

interface MediaGalleryProps {
  mode: 'camera' | 'local'
  groupTitle: (group: string) => string
}

type ScrollTarget = HTMLElement | Window

function scrollTopOf(target: ScrollTarget): number {
  return target === window ? window.scrollY : (target as HTMLElement).scrollTop
}

function setScrollTop(target: ScrollTarget, top: number): void {
  if (target === window) window.scrollTo(window.scrollX, top)
  else (target as HTMLElement).scrollTop = top
}

export function MediaGallery({ mode, groupTitle }: MediaGalleryProps) {
  const ctrl = useMediaLib()
  const { downloadProgress } = ctrl
  const isLocal = mode === 'local'
  const galleryRef = useRef<HTMLDivElement>(null)
  const dateNavListRef = useRef<HTMLElement>(null)
  const scrollTargetRef = useRef<ScrollTarget | null>(null)
  const contentScrollFrameRef = useRef(0)
  const dateNavScrollFrameRef = useRef(0)
  const navigationTargetRef = useRef<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [dateNavCollapsed, setDateNavCollapsed] = useState(false)
  const [activeDateGroup, setActiveDateGroup] = useState<string | null>(ctrl.firstGroup)
  const groupSignature = ctrl.groups.map(([group]) => group).join('\0')
  const selectedLocalPaths = useMemo(() => ctrl.selectedFiles
    .map((file) => file.downloadFilePath ?? file.localPath)
    .filter((filePath): filePath is string => Boolean(filePath)), [ctrl.selectedFiles])

  useEffect(() => {
    setActiveDateGroup(ctrl.firstGroup)
  }, [ctrl.firstGroup])

  useEffect(() => {
    const gallery = galleryRef.current
    if (!gallery || !groupSignature) return
    const sections = [...gallery.querySelectorAll<HTMLElement>('.media-section[data-group]')]
    let scrollParent: HTMLElement | null = gallery
    while (scrollParent) {
      const { overflowY } = window.getComputedStyle(scrollParent)
      if (overflowY === 'auto' || overflowY === 'scroll') break
      scrollParent = scrollParent.parentElement
    }

    let frame = 0
    const updateActiveDate = () => {
      if (navigationTargetRef.current) return
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        if (navigationTargetRef.current) return
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
    scrollTargetRef.current = target
    target.addEventListener('scroll', updateActiveDate, { passive: true })
    window.addEventListener('resize', updateActiveDate)
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(contentScrollFrameRef.current)
      navigationTargetRef.current = null
      scrollTargetRef.current = null
      target.removeEventListener('scroll', updateActiveDate)
      window.removeEventListener('resize', updateActiveDate)
    }
  }, [groupSignature])

  useEffect(() => {
    if (!activeDateGroup || navigationTargetRef.current) return
    const nav = dateNavListRef.current
    const activeItem = [...(nav?.querySelectorAll<HTMLElement>('[data-date-nav-group]') ?? [])]
      .find((candidate) => candidate.dataset.dateNavGroup === activeDateGroup)
    if (!nav || !activeItem) return

    window.cancelAnimationFrame(dateNavScrollFrameRef.current)
    const startTop = nav.scrollTop
    const navRect = nav.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const centeredTop = startTop + itemRect.top - navRect.top - (nav.clientHeight - itemRect.height) / 2
    const targetTop = Math.min(Math.max(0, nav.scrollHeight - nav.clientHeight), Math.max(0, centeredTop))
    const distance = targetTop - startTop
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 80
    const startTime = performance.now()
    const animate = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration)
      nav.scrollTop = startTop + distance * (1 - (1 - progress) ** 3)
      if (progress < 1) dateNavScrollFrameRef.current = window.requestAnimationFrame(animate)
    }
    dateNavScrollFrameRef.current = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(dateNavScrollFrameRef.current)
  }, [activeDateGroup, dateNavCollapsed])

  function scrollToGroup(group: string): void {
    const gallery = galleryRef.current
    const section = [...(gallery?.querySelectorAll<HTMLElement>('.media-section[data-group]') ?? [])]
      .find((candidate) => candidate.dataset.group === group)
    setActiveDateGroup(group)
    const target = scrollTargetRef.current
    if (!gallery || !section || !target) return

    const currentTop = scrollTopOf(target)
    const resolveTargetTop = () => {
      const targetRect = target === window
        ? { top: 0, height: window.innerHeight }
        : (target as HTMLElement).getBoundingClientRect()
      const latestTop = scrollTopOf(target)
      const sectionRect = section.getBoundingClientRect()
      const targetTop = latestTop + sectionRect.top - targetRect.top - 58
      const maxScrollTop = target === window
        ? Math.max(0, document.documentElement.scrollHeight - targetRect.height)
        : Math.max(0, (target as HTMLElement).scrollHeight - targetRect.height)
      return Math.min(maxScrollTop, Math.max(0, targetTop))
    }
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    const startTime = performance.now()

    window.cancelAnimationFrame(contentScrollFrameRef.current)
    navigationTargetRef.current = group
    const settleAtLatestPosition = (framesRemaining: number) => {
      setScrollTop(target, resolveTargetTop())
      if (framesRemaining > 0) {
        contentScrollFrameRef.current = window.requestAnimationFrame(() => settleAtLatestPosition(framesRemaining - 1))
      } else {
        navigationTargetRef.current = null
      }
    }
    const animate = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - startTime) / duration)
      const eased = 1 - (1 - progress) ** 3
      setScrollTop(target, currentTop + (resolveTargetTop() - currentTop) * eased)
      if (progress < 1) {
        contentScrollFrameRef.current = window.requestAnimationFrame(animate)
      } else {
        settleAtLatestPosition(2)
      }
    }
    contentScrollFrameRef.current = window.requestAnimationFrame(animate)
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
        {!dateNavCollapsed && <nav ref={dateNavListRef} className="media-date-nav-list">
          {ctrl.groups.map(([group, items]) => (
            <Button
              key={group}
              variant="ghost"
              size="compact"
              className={`media-date-nav-item${activeDateGroup === group ? ' active' : ''}`}
              data-date-nav-group={group}
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
          <LoadingIndicator size="large" label={isLocal ? '正在读取已下载文件' : `正在读取 ${ctrl.mediaSourceLabel}`} />
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
                  onDragStart={isSelected && localPath ? () => window.luna.startFileDrag(selectedLocalPaths, file.thumbnailUrl) : undefined}
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
