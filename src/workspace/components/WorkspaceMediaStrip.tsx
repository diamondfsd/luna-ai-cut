import { FolderOpen } from 'lucide-react'
import { type MouseEvent, type WheelEvent, useEffect, useRef, useState } from 'react'

import type { WorkspaceMediaAsset, WorkspaceMediaKind } from '../../shared/types'
import { mergePipeline, normalizePersistedPipelinePatch, type EditPipeline } from '../shared/editPipeline'
import { createWorkspaceDefaultPipeline } from '../shared/workspaceDefaultPipeline'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { useApp } from '../../context/AppContext'
import { useDeviceConnection } from '../../context/DeviceConnectionContext'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, LivePhotoBadge, VideoPlayBadge, toast } from '../../ui'
import { ThumbImage } from '../../components/ThumbImage'
import { WorkspaceMissingMedia } from './WorkspaceMissingMedia'
import dolbyVisionLogo from '../../assets/logos/dolby-vision-vertical.png'
import '../../styles/media-card-format-badge.css'
import './WorkspaceMediaStrip.css'

interface MediaFormatInfo {
  dolbyVision: boolean
  iLog: boolean
  raw: boolean
  duration: number | null
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

/** 检查素材的 pipeline 是否有非默认的修改 */
function isAssetModified(item: WorkspaceMediaAsset, defaultPipeline: EditPipeline): boolean {
  const raw = (item as unknown as { pipeline?: unknown }).pipeline
  if (!raw || typeof raw !== 'object') return false
  const normalized = mergePipeline(structuredClone(defaultPipeline), normalizePersistedPipelinePatch(raw).patch)
  return JSON.stringify(normalized) !== JSON.stringify(defaultPipeline)
}

interface WorkspaceMediaStripProps {
  supportedMediaKinds?: readonly WorkspaceMediaKind[]
}

export function WorkspaceMediaStrip({ supportedMediaKinds }: WorkspaceMediaStripProps = {}) {
  const { media: mediaList, brokenPaths, setBrokenPaths, selectedIndices, setSelectedIndices, activeIndex, setActiveIndex, handleSelectionChange } = useWorkspaceMedia()
  const { settings } = useApp()
  const { activeDevice, isConnected } = useDeviceConnection()
  const connectedDeviceMetadata = isConnected && activeDevice
    ? { sourceDeviceId: activeDevice.id, sourceDeviceName: activeDevice.name, cameraType: activeDevice.name, watermarkProfileId: activeDevice.id }
    : null
  const defaultPipeline = createWorkspaceDefaultPipeline(settings, mediaList[activeIndex], connectedDeviceMetadata)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [dragHighlighted, setDragHighlighted] = useState<Set<number>>(new Set())
  const [formatInfoByPath, setFormatInfoByPath] = useState<Map<string, MediaFormatInfo>>(new Map())
  const visibleMedia = mediaList
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !supportedMediaKinds || supportedMediaKinds.includes(item.kind))
  const visibleIndices = visibleMedia.map(({ index }) => index)
  const visibleIndexSet = new Set(visibleIndices)

  useEffect(() => {
    let canceled = false
    const missingItems = mediaList.filter((item) => !formatInfoByPath.has(item.path))
    if (missingItems.length === 0) return

    void Promise.all(missingItems.map(async (item) => {
      try {
        const [info, duration] = await Promise.all([
          window.luna.workspace.getMediaFormatInfo(item.path),
          item.kind === 'video' ? window.luna.workspace.getVideoDuration(item.path).catch(() => null) : Promise.resolve(null),
        ])
        return [item.path, { ...info, duration }] as const
      } catch {
        return [item.path, { dolbyVision: false, iLog: false, raw: false, duration: null }] as const
      }
    })).then((entries) => {
      if (canceled) return
      setFormatInfoByPath((current) => {
        const next = new Map(current)
        for (const [filePath, info] of entries) next.set(filePath, info)
        return next
      })
    })
    return () => { canceled = true }
  }, [formatInfoByPath, mediaList])

  function handleClick(index: number, event: MouseEvent): void {
    containerRef.current?.focus({ preventScroll: true })
    window.dispatchEvent(new CustomEvent('workspace-media-strip-click', { detail: { index } }))
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (supportedMediaKinds) {
        setSelectedIndices((current) => {
          const selectedVisible = [...current].filter((selectedIndex) => visibleIndexSet.has(selectedIndex))
          if (event.shiftKey && selectedVisible.length > 0) {
            const clickedPosition = visibleIndices.indexOf(index)
            const anchor = selectedVisible.reduce((nearest, selectedIndex) => {
              const position = visibleIndices.indexOf(selectedIndex)
              return Math.abs(position - clickedPosition) < Math.abs(visibleIndices.indexOf(nearest) - clickedPosition)
                ? selectedIndex
                : nearest
            })
            const anchorPosition = visibleIndices.indexOf(anchor)
            const from = Math.min(anchorPosition, clickedPosition)
            const to = Math.max(anchorPosition, clickedPosition)
            return new Set(visibleIndices.slice(from, to + 1))
          }
          const next = new Set(selectedVisible)
          if (next.has(index)) next.delete(index)
          else next.add(index)
          return next
        })
        return
      }
      handleSelectionChange(index, { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey })
      return
    }
    setActiveIndex(index)
    setSelectedIndices(new Set([index]))
  }

  function handlePointerDown(e: React.PointerEvent): void {
    if (e.button !== 0) return
    if (!e.currentTarget.contains(e.target as Node)) return
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
    thumbs.forEach((thumb) => {
      const index = Number(thumb.dataset.mediaIndex)
      if (!Number.isInteger(index)) return
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
      const toggled = new Set(supportedMediaKinds
        ? [...selectedIndices].filter((index) => visibleIndexSet.has(index))
        : selectedIndices)
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
      const allIndices = new Set(visibleMedia.map(({ index }) => index))
      setSelectedIndices(allIndices)
    }
  }

  function handleWheel(e: WheelEvent<HTMLDivElement>): void {
    const container = containerRef.current
    if (!container || container.scrollWidth <= container.clientWidth) return

    const delta = e.deltaX + e.deltaY
    if (delta === 0) return

    e.preventDefault()
    container.scrollLeft += delta
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
      onWheel={handleWheel}
    >
      {visibleMedia.map(({ item, index }) => {
        const isBroken = brokenPaths.has(item.path)
        const isActive = index === activeIndex
        const isSelected = selectedIndices.has(index)
        const isDragHighlighted = dragHighlighted.has(index)
        const isModified = !isBroken && isAssetModified(item, defaultPipeline)
        const formatInfo = formatInfoByPath.get(item.path)
        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger asChild>
              <button
                className={`workspace-thumb${isActive ? ' active' : ''}${isSelected || isDragHighlighted ? ' selected' : ''}${isBroken ? ' is-broken' : ''}`}
                data-media-index={index}
                type="button"
                onClick={(e) => handleClick(index, e)}
              >
                {isModified && <span className="workspace-thumb-modified-dot" />}
                {isBroken
                  ? <WorkspaceMissingMedia />
                  : <ThumbImage
                      src={item.thumbnailUrl ?? item.path}
                      alt=""
                      draggable={false}
                      unavailableFallback={<WorkspaceMissingMedia />}
                      onUnavailable={(filePath) => setBrokenPaths((current) => current.has(filePath) ? current : new Set(current).add(filePath))}
                    />}
                {item.kind === 'video' && formatInfo?.duration != null && <span className="workspace-thumb-duration">{formatDuration(formatInfo.duration)}</span>}
                {item.kind === 'video' && <VideoPlayBadge size={20} />}
                {item.isLivePhoto && <LivePhotoBadge size={22} className="workspace-thumb-live-chip" />}
                {formatInfo?.dolbyVision ? (
                  <span className="video-format-badge dolby-vision-badge" title="杜比视界">
                    <img src={dolbyVisionLogo} alt="Dolby Vision" />
                  </span>
                ) : formatInfo?.iLog ? (
                  <span className="video-format-badge i-log-badge" title="I-Log">I-LOG</span>
                ) : formatInfo?.raw ? (
                  <span className="video-format-badge raw-badge" title="包含 RAW 原始文件">RAW</span>
                ) : null}
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
