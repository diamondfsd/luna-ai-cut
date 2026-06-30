import { ImageOff } from 'lucide-react'
import { type MouseEvent, useRef, useState } from 'react'
import type { WorkspaceMediaAsset } from '../../shared/types'

interface WorkspaceMediaStripProps {
  media: WorkspaceMediaAsset[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  /** 多选：已选中的索引集合 */
  selectedIndices?: Set<number>
  /** 多选：选中变更回调，index 为当前点击项，含有元信息 */
  onSelectionChange?: (index: number, modifiers: { shift: boolean; ctrl: boolean; meta: boolean }) => void
  /** 文件已删除的素材路径集合 */
  brokenPaths?: Set<string>
  /** 拖拽框选回调 */
  onDragSelectionChange?: (indices: Set<number>) => void
}

export function WorkspaceMediaStrip({ media, activeIndex, onActiveIndexChange, selectedIndices, onSelectionChange, brokenPaths, onDragSelectionChange }: WorkspaceMediaStripProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [dragHighlighted, setDragHighlighted] = useState<Set<number>>(new Set())

  function handleClick(index: number, event: MouseEvent): void {
    if (onSelectionChange && (event.shiftKey || event.ctrlKey || event.metaKey)) {
      onSelectionChange(index, { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey })
      return
    }
    onActiveIndexChange(index)
  }

  function handlePointerDown(e: React.PointerEvent): void {
    // 只响应左键，且在缩略图按钮上不触发拖拽
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.workspace-thumb')) return
    if (!onDragSelectionChange) return

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

    // 计算选框覆盖的缩略图
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

  function handlePointerUp(_e: React.PointerEvent): void {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragRect(null)

    if (dragHighlighted.size > 0) {
      // 切换模式：已选中的移除，未选中的叠加
      const toggled = new Set(selectedIndices ?? [])
      for (const idx of dragHighlighted) {
        if (toggled.has(idx)) toggled.delete(idx)
        else toggled.add(idx)
      }
      onDragSelectionChange?.(toggled)
    }
    setDragHighlighted(new Set())
  }

  return (
    <div
      ref={containerRef}
      className="workspace-media-strip"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {media.map((item, index) => {
        const isBroken = brokenPaths?.has(item.path)
        const isActive = index === activeIndex
        const isSelected = selectedIndices?.has(index)
        const isDragHighlighted = dragHighlighted.has(index)
        return (
          <button
            key={item.id}
            className={`workspace-thumb${isActive ? ' active' : ''}${isSelected || isDragHighlighted ? ' selected' : ''}${isBroken ? ' is-broken' : ''}`}
            type="button"
            onClick={(e) => handleClick(index, e)}
          >
            <span className="workspace-thumb-preview">
              {isBroken ? <ImageOff size={20} className="workspace-thumb-broken" /> : item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{item.kind === 'video' ? '视频' : '图片'}</span>}
            </span>
          </button>
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
