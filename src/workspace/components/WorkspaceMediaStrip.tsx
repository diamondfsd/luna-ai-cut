import { FolderOpen, ImageOff } from 'lucide-react'
import { type MouseEvent, useRef, useState } from 'react'

import type { WorkspaceMediaAsset } from '../../shared/types'
import { mergePipeline, type EditPipeline } from '../shared/editPipeline'
import type { PipelinePatch } from '../shared/editPipeline'
import { createWorkspaceDefaultPipeline } from '../shared/workspaceDefaultPipeline'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { useApp } from '../../context/AppContext'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, LivePhotoBadge, VideoPlayBadge, toast } from '../../ui'
import { ThumbImage } from '../../components/ThumbImage'

/** 检查素材的 pipeline 是否有非默认的修改 */
function isAssetModified(item: WorkspaceMediaAsset, defaultPipeline: EditPipeline): boolean {
  const raw = (item as unknown as { pipeline?: unknown }).pipeline
  if (!raw || typeof raw !== 'object') return false
  const normalized = mergePipeline(structuredClone(defaultPipeline), raw as PipelinePatch)
  return JSON.stringify(normalized) !== JSON.stringify(defaultPipeline)
}

export function WorkspaceMediaStrip() {
  const { media: mediaList, brokenPaths, selectedIndices, setSelectedIndices, activeIndex, setActiveIndex, handleSelectionChange } = useWorkspaceMedia()
  const { settings } = useApp()
  const defaultPipeline = createWorkspaceDefaultPipeline(settings)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [dragHighlighted, setDragHighlighted] = useState<Set<number>>(new Set())

  function handleClick(index: number, event: MouseEvent): void {
    containerRef.current?.focus({ preventScroll: true })
    window.dispatchEvent(new CustomEvent('workspace-media-strip-click', { detail: { index } }))
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      handleSelectionChange(index, { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey })
      return
    }
    setActiveIndex(index)
    setSelectedIndices(new Set([index]))
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    containerRef.current?.focus({ preventScroll: true })
    if ((e.target as HTMLElement).closest('.workspace-thumb')) return

    dragStartRef.current = { x: e.clientX, y: e.clientY }
    containerRef.current?.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    const container = containerRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const left = Math.min(dragStartRef.current.x, e.clientX) - containerRect.left + container.scrollLeft
    const top = Math.min(dragStartRef.current.y, e.clientY) - containerRect.top
    const width = Math.abs(e.clientX - dragStartRef.current.x)
    const height = Math.abs(e.clientY - dragStartRef.current.y)
    setDragRect({ left, top, width, height })

    const dragBounds = {
      left: Math.min(dragStartRef.current.x, e.clientX),
      right: Math.max(dragStartRef.current.x, e.clientX),
      top: Math.min(dragStartRef.current.y, e.clientY),
      bottom: Math.max(dragStartRef.current.y, e.clientY),
    }

    const thumbs = container.querySelectorAll<HTMLElement>('.workspace-thumb')
    const highlighted = new Set<number>()
    thumbs.forEach((thumb, index) => {
      const rect = thumb.getBoundingClientRect()
      if (rect.left < dragBounds.right && rect.right > dragBounds.left &&
          rect.top < dragBounds.bottom && rect.bottom > dragBounds.top) {
        highlighted.add(index)
      }
    })
    setDragHighlighted(highlighted)
  }

  function handlePointerUp(): void {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragRect(null)

    if (dragHighlighted.size > 0) {
      const toggled = new Set(selectedIndices)
      for (const idx of dragHighlighted) {
        if (toggled.has(idx)) toggled.delete(idx)
        else toggled.add(idx)
      }
      setSelectedIndices(toggled)
    }
    setDragHighlighted(new Set())
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      const allIndices = new Set(mediaList.map((_, i) => i))
      setSelectedIndices(allIndices)
    }
  }

  async function revealAsset(filePath: string): Promise<void> {
    try {
      await window.luna.revealFile(filePath)
    } catch {
      toast.error('无法打开所在文件夹')
    }
  }

  return (
    <div
      ref={containerRef}
      className="workspace-media-strip"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      {mediaList.map((item, index) => {
        const isBroken = brokenPaths.has(item.path)
        const isActive = index === activeIndex
        const isSelected = selectedIndices.has(index)
        const isDragHighlighted = dragHighlighted.has(index)
        const isModified = !isBroken && isAssetModified(item, defaultPipeline)
        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger asChild>
              <button
                className={`workspace-thumb${isActive ? ' active' : ''}${isSelected || isDragHighlighted ? ' selected' : ''}${isBroken ? ' is-broken' : ''}`}
                type="button"
                onClick={(e) => handleClick(index, e)}
              >
                {isModified && <span className="workspace-thumb-modified-dot" />}
                {isBroken ? <ImageOff size={20} className="workspace-thumb-broken" /> : <ThumbImage src={item.path} alt="" draggable={false} />}
                {item.kind === 'video' && <VideoPlayBadge size={20} />}
                {item.isLivePhoto && <LivePhotoBadge size={22} className="workspace-thumb-live-chip" />}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => void revealAsset(item.path)}>
                <FolderOpen size={15} />
                打开所在文件夹
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      {dragRect && (
        <div
          className="workspace-drag-select"
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
