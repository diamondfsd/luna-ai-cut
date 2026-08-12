import { CalendarDays, FileQuestion, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  const dragCurrentRef = useRef<{ x: number; y: number } | null>(null)
  const dragFrameRef = useRef(0)
  const dragOverlayRef = useRef<HTMLDivElement>(null)
  const dragCardsRef = useRef<Array<{
    element: HTMLElement
    id: string
    rect: DOMRect
  }>>([])
  const dragSelectedIdsRef = useRef<Set<string>>(new Set())
  const [dateNavCollapsed, setDateNavCollapsed] = useState(false)
  const [activeDateGroup, setActiveDateGroup] = useState<string | null>(ctrl.firstGroup)
  const groupSignature = ctrl.groups.map(([group]) => group).join('\0')
  const selectedLocalPaths = useMemo(() => ctrl.selectedFiles
    .map((file) => file.downloadFilePath ?? file.localPath)
    .filter((filePath): filePath is string => Boolean(filePath)), [ctrl.selectedFiles])

  const clearDragPreview = useCallback(() => {
    window.cancelAnimationFrame(dragFrameRef.current)
    dragFrameRef.current = 0
    dragOverlayRef.current?.style.setProperty('display', 'none')
    for (const { element } of dragCardsRef.current) {
      element.classList.remove('drag-selected')
    }
    dragCardsRef.current = []
    dragSelectedIdsRef.current = new Set()
  }, [])

  useEffect(() => clearDragPreview, [clearDragPreview])

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
    dragCurrentRef.current = { x: e.clientX, y: e.clientY }
    const gallery = galleryRef.current
    dragCardsRef.current = gallery
      ? [...gallery.querySelectorAll<HTMLElement>('.media-card')]
          .map((element) => ({
            element,
            id: element.dataset.fileId ?? '',
            rect: element.getBoundingClientRect(),
          }))
          .filter(({ id }) => id.length > 0)
      : []
    galleryRef.current?.setPointerCapture(e.pointerId)
  }

  function updateDragPreview(): void {
    dragFrameRef.current = 0
    const start = dragStartRef.current
    const current = dragCurrentRef.current
    const gallery = galleryRef.current
    const overlay = dragOverlayRef.current
    if (!start || !current || !gallery || !overlay) return

    const rect = gallery.getBoundingClientRect()
    const left = Math.min(start.x, current.x) - rect.left + gallery.scrollLeft
    const top = Math.min(start.y, current.y) - rect.top + gallery.scrollTop
    const width = Math.abs(current.x - start.x)
    const height = Math.abs(current.y - start.y)
    overlay.style.display = 'block'
    overlay.style.transform = `translate3d(${left}px, ${top}px, 0)`
    overlay.style.width = `${width}px`
    overlay.style.height = `${height}px`

    const dragBounds = {
      left: Math.min(start.x, current.x),
      right: Math.max(start.x, current.x),
      top: Math.min(start.y, current.y),
      bottom: Math.max(start.y, current.y),
    }

    const selectedIds = new Set<string>()
    for (const { element, id, rect: cardRect } of dragCardsRef.current) {
      const overlaps =
        cardRect.left < dragBounds.right &&
        cardRect.right > dragBounds.left &&
        cardRect.top < dragBounds.bottom &&
        cardRect.bottom > dragBounds.top
      element.classList.toggle('drag-selected', overlaps)
      if (overlaps) selectedIds.add(id)
    }
    dragSelectedIdsRef.current = selectedIds
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    dragCurrentRef.current = { x: e.clientX, y: e.clientY }
    if (dragFrameRef.current === 0) {
      dragFrameRef.current = window.requestAnimationFrame(updateDragPreview)
    }
  }

  function handlePointerUp(): void {
    if (!dragStartRef.current) return
    if (dragFrameRef.current !== 0) {
      window.cancelAnimationFrame(dragFrameRef.current)
      updateDragPreview()
    }
    dragStartRef.current = null
    dragCurrentRef.current = null
    const dragSelectedIds = dragSelectedIdsRef.current
    clearDragPreview()

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

      <div ref={dragOverlayRef} className="gallery-drag-select" />
      </div>
    </div>
  )
}
