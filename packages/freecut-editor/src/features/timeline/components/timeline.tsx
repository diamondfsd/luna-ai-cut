import { useEffect, useRef, useState, memo, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TimelineHeader } from './timeline-header'
import { TimelineContent } from './timeline-content'
import { TimelineNavigator } from './timeline-navigator'
import { TrackHeader } from './track-header'
import { TransitionDragTooltip } from './transition-drag-tooltip'
import { FirstTrackRowFrame, TrackRowFrame } from './track-row-frame'
import { useTimelineTracks } from '../hooks/use-timeline-tracks'
import { useItemsStore } from '../stores/items-store'
import { useSelectionStore } from '@freecut/shared/state/selection'
import { useEditorStore } from '@freecut/shared/state/editor'
import { useTimelineStore } from '../stores/timeline-store'
import { useSettingsStore } from '@freecut/features/timeline/deps/settings'

import { Button } from '@freecut/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@freecut/components/ui/dropdown-menu'
import {
  Plus,
  Minus,
  Rows4,
  Rows3,
  Rows2,
  Check,
  Video,
  AudioLines,
  PanelTopClose,
  PanelTopOpen,
} from 'lucide-react'
import { CompositionBreadcrumbs } from './composition-breadcrumbs'
import { SequenceTabs } from './sequence-tabs'
import { useCompositionNavigationStore } from '../stores/composition-navigation-store'
import {
  trackDropIndexRef,
  trackDragOffsetRef,
  trackDragJustDroppedRef,
} from '../hooks/use-track-drag'
import { createClassicTrack, getAdjacentTrackOrder, getTrackKind } from '../utils/classic-tracks'
import { getEmptyTrackIdsForRemoval } from '../utils/track-removal'
import { createLogger } from '@freecut/shared/logging/logger'
import { EDITOR_LAYOUT_CSS_VALUES, getEditorLayout } from '@freecut/config/editor-layout'
import { useTrackHeightResize } from '../hooks/use-track-height-resize'
import { resizeTracksOfKindByDelta } from '../utils/track-resize'
import {
  applyTrackSizePreset,
  commitTrackHeights,
  toggleTrackPreviewCollapsed,
} from '../stores/actions/track-height-actions'
import { useZoomStore } from '../stores/zoom-store'
import { computeWheelZoomStep } from '../constants'
import { clearMediaDragData } from '@freecut/features/timeline/deps/media-library-resolver'
import { notifyTimelineLiveScroll } from '@freecut/shared/timeline/live-scroll-sync'
import { useNewTrackZonePreviewStore } from '../stores/new-track-zone-preview-store'
import { useTrackDropPreviewStore } from '../stores/track-drop-preview-store'
import { clearAllTimelineDropPreviewOwners } from '../utils/drop-preview-owner'
import {
  isDragEventOverTimelineDropTarget,
  isExternalTimelineDragEvent,
} from '../utils/timeline-external-drag'
import { getDefaultActiveTrackId } from '../utils/default-active-track'
import { KeyframeGraphPanel } from './keyframe-graph-panel'

const logger = createLogger('Timeline')

/**
 * Track height presets exposed through the track-size flyout. Their heights
 * live in `TRACK_SIZE_PRESET_HEIGHTS`; picking one is a local view preference,
 * not a project edit.
 */
const TRACK_SIZE_OPTIONS = [
  { id: 'compact', icon: Rows4, labelKey: 'timeline.trackSize.compact' },
  { id: 'medium', icon: Rows3, labelKey: 'timeline.trackSize.medium' },
  { id: 'large', icon: Rows2, labelKey: 'timeline.trackSize.large' },
] as const

interface TimelineProps {
  duration: number // Total timeline duration in seconds
}

/**
 * Complete Timeline Component
 *
 * Combines:
 * - TimelineHeader (controls, zoom, snap)
 * - Track Headers Sidebar (track labels and controls)
 * - TimelineContent (markers, playhead, tracks, items)
 *
 * Follows modular architecture with granular Zustand selectors
 */
export const Timeline = memo(function Timeline({ duration }: TimelineProps) {
  const { t } = useTranslation()
  const editorDensity = useSettingsStore((s) => s.editorDensity)
  const editorLayout = getEditorLayout(editorDensity)
  const {
    tracks,
    addTrack,
    removeTracks,
    toggleTrackDisabled,
    toggleTrackLock,
    toggleTrackSyncLock,
    toggleTrackSolo,
  } = useTimelineTracks()
  // Selection state - use granular selectors
  const activeTrackId = useSelectionStore((s) => s.activeTrackId)
  const selectedTrackIds = useSelectionStore((s) => s.selectedTrackIds)
  const setActiveTrack = useSelectionStore((s) => s.setActiveTrack)
  const toggleTrackSelection = useSelectionStore((s) => s.toggleTrackSelection)
  const selectTracks = useSelectionStore((s) => s.selectTracks)
  const selectedTrackIdsSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds])

  const visibleTracks = tracks
  const canDeleteEmptyTracks = useItemsStore(
    useCallback(
      (s) => {
        let emptyTrackCount = 0

        for (const track of tracks) {
          if ((s.itemsByTrackId[track.id]?.length ?? 0) === 0) {
            emptyTrackCount += 1
          }
        }

        if (emptyTrackCount === 0) return false
        if (emptyTrackCount < tracks.length) return true
        return tracks.length > 1
      },
      [tracks],
    ),
  )
  const videoTracks = useMemo(
    () => visibleTracks.filter((track) => getTrackKind(track) === 'video'),
    [visibleTracks],
  )
  const audioTracks = useMemo(
    () => visibleTracks.filter((track) => getTrackKind(track) === 'audio'),
    [visibleTracks],
  )
  const keyframePanelOpen = useSelectionStore((s) => s.editKeyframePanelOpen)
  const setKeyframePanelOpen = useSelectionStore((s) => s.setEditKeyframePanelOpen)
  // Refs for syncing scroll between track headers and timeline content
  const trackHeadersViewportRef = useRef<HTMLDivElement>(null)
  const trackHeadersRootRef = useRef<HTMLDivElement>(null)
  const timelineContentRef = useRef<HTMLDivElement>(null)
  const allTrackHeadersScrollRef = useRef<HTMLDivElement>(null)
  const allTrackContentScrollRef = useRef<HTMLDivElement>(null)

  // Store zoom handlers from TimelineContent
  const [zoomHandlers, setZoomHandlers] = useState<{
    handleZoomChange: (newZoom: number) => void
    handleZoomIn: () => void
    handleZoomOut: () => void
    handleZoomToFit: () => void
  } | null>(null)
  const trackSizePreset = useEditorStore((s) => s.trackSizePreset)
  const trackPreviewCollapsed = useEditorStore((s) => s.trackPreviewCollapsed)
  const setTimelineTracks = useTimelineStore((s) => s.setTracks)

  useEffect(() => {
    const clearExternalDropPreviews = () => {
      clearAllTimelineDropPreviewOwners()
      useTrackDropPreviewStore.getState().clearGhostPreviews()
      useNewTrackZonePreviewStore.getState().clearGhostPreviews()
    }

    const handleDragEnd = () => {
      clearExternalDropPreviews()
      clearMediaDragData()
    }
    const handleDragOver = (event: DragEvent) => {
      if (!isExternalTimelineDragEvent(event) || isDragEventOverTimelineDropTarget(event)) {
        return
      }

      clearExternalDropPreviews()
    }
    const handleDrop = () => {
      window.setTimeout(() => {
        clearExternalDropPreviews()
        clearMediaDragData()
      }, 0)
    }
    const handleBlur = () => {
      clearExternalDropPreviews()
      clearMediaDragData()
    }

    document.addEventListener('dragenter', handleDragOver, true)
    document.addEventListener('dragover', handleDragOver, true)
    window.addEventListener('dragend', handleDragEnd, true)
    document.addEventListener('drop', handleDrop, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('dragenter', handleDragOver, true)
      document.removeEventListener('dragover', handleDragOver, true)
      window.removeEventListener('dragend', handleDragEnd, true)
      document.removeEventListener('drop', handleDrop, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // State for drop indicator (updated via RAF from drag hook)
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState(-1)

  // Granular selector: only re-render when track dragging state actually changes
  const isTrackDragging = useSelectionStore(
    (s) =>
      (s.dragState?.isDragging &&
        s.dragState.draggedTrackIds &&
        s.dragState.draggedTrackIds.length > 0) ??
      false,
  )

  const { handleTrackResizeStart, handleTrackResizeReset } = useTrackHeightResize()
  const videoZoneHeight = 24
  const audioZoneHeight = 24
  const getTrackStackOffset = useCallback(
    (sectionTracks: typeof visibleTracks, dropIndex: number, leadingOffset = 0) => {
      return (
        leadingOffset +
        sectionTracks
          .slice(0, Math.max(0, Math.min(dropIndex, sectionTracks.length)))
          .reduce((sum, track) => sum + track.height, 0)
      )
    },
    [],
  )

  // Wheel handling in track headers:
  //   Alt+scroll = resize track heights in the hovered zone
  //   Scroll over a track = vertical scroll of the shared track list
  //   Ctrl/Cmd+scroll = zoom timeline in/out
  const zoomHandlersRef = useRef(zoomHandlers)
  useEffect(() => {
    zoomHandlersRef.current = zoomHandlers
  }, [zoomHandlers])
  useEffect(() => {
    const el = trackHeadersViewportRef.current
    if (!el) return

    const handler = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const z = zoomHandlersRef.current
        if (!z) return
        z.handleZoomChange(computeWheelZoomStep(useZoomStore.getState().level, event.deltaY))
        return
      }

      const sectionEl =
        event.target instanceof Element
          ? (event.target.closest('[data-track-section]') as HTMLElement | null)
          : null
      const zone = sectionEl?.dataset.trackSection as 'video' | 'audio' | undefined

      if (event.altKey) {
        event.preventDefault()
        if (!zone) return
        const delta = event.deltaY > 0 ? -4 : 4
        const currentTracks = useItemsStore.getState().tracks
        const nextTracks = resizeTracksOfKindByDelta(currentTracks, zone, delta)
        if (nextTracks !== currentTracks) {
          commitTrackHeights(nextTracks)
        }
        return
      }

      event.preventDefault()
      const scrollHorizontally = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (scrollHorizontally) {
        const timelineScroll = timelineContentRef.current
        if (!timelineScroll) return
        timelineScroll.scrollLeft += event.deltaX || event.deltaY
        notifyTimelineLiveScroll(timelineScroll)
        return
      }
      const contentScroll = allTrackContentScrollRef.current
      if (!contentScroll) return
      contentScroll.scrollTop += event.deltaY || event.deltaX
    }

    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  // Set the default edit target on mount.
  const tracksLength = tracks.length
  const defaultActiveTrackId = useMemo(() => getDefaultActiveTrackId(tracks), [tracks])
  useEffect(() => {
    if (tracksLength > 0 && !activeTrackId && defaultActiveTrackId) {
      setActiveTrack(defaultActiveTrackId)
    }
  }, [tracksLength, activeTrackId, defaultActiveTrackId, setActiveTrack])

  useEffect(() => {
    const source = allTrackContentScrollRef.current
    const target = allTrackHeadersScrollRef.current
    if (!source || !target) return

    const handleScroll = () => {
      if (target.scrollTop !== source.scrollTop) {
        target.scrollTop = source.scrollTop
      }
    }

    handleScroll()
    source.addEventListener('scroll', handleScroll, { passive: true })
    return () => source.removeEventListener('scroll', handleScroll)
  }, [tracksLength])

  // Update drop indicator from shared ref (only during drag)
  // Only runs RAF loop when track dragging is active to avoid unnecessary renders
  useEffect(() => {
    if (!isTrackDragging) {
      setDropIndicatorIndex(-1)
      return
    }

    let rafId: number
    const updateDropIndicator = () => {
      const newIndex = trackDropIndexRef.current
      setDropIndicatorIndex((prev) => (prev !== newIndex ? newIndex : prev))
      rafId = requestAnimationFrame(updateDropIndicator)
    }

    rafId = requestAnimationFrame(updateDropIndicator)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [isTrackDragging])

  // Drag visuals: move all dragged track headers together with their clip rows via
  // direct DOM manipulation. Headers and content rows both carry data-track-id, so the
  // dragged track's clips ghost-follow the header in lockstep.
  // This handles groups (header + children move as one) and multi-select drag.
  useEffect(() => {
    if (!isTrackDragging) return

    const dragState = useSelectionStore.getState().dragState
    if (!dragState?.draggedTrackIds?.length) return

    const draggedIds = new Set(dragState.draggedTrackIds)
    const container = trackHeadersRootRef.current
    if (!container) return

    // Content clip rows live under the track-sections surface, scoped here so we don't
    // also match the header rows (both use data-track-id).
    const getContentRows = (): NodeListOf<HTMLElement> | HTMLElement[] =>
      document
        .getElementById('timeline-track-sections')
        ?.querySelectorAll<HTMLElement>('[data-track-id]') ?? []

    let rafId: number
    const updateDragVisuals = () => {
      const offset = trackDragOffsetRef.current
      const elements = container.querySelectorAll<HTMLElement>('[data-track-id]')
      for (const el of elements) {
        const trackId = el.getAttribute('data-track-id')
        if (trackId && draggedIds.has(trackId)) {
          el.style.transform = `translateY(${offset}px) scale(1.02)`
          el.style.zIndex = '100'
          el.style.opacity = '0.5'
          el.style.transition = 'none'
          el.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'
        }
      }
      // Clip rows ghost-follow the header. No horizontal scale here — it would shift the
      // clips sideways; just translate + dim so the clips track the drag.
      for (const el of getContentRows()) {
        const trackId = el.getAttribute('data-track-id')
        if (trackId && draggedIds.has(trackId)) {
          el.style.transform = `translateY(${offset}px)`
          el.style.zIndex = '50'
          el.style.opacity = '0.5'
          el.style.transition = 'none'
        }
      }
      rafId = requestAnimationFrame(updateDragVisuals)
    }

    rafId = requestAnimationFrame(updateDragVisuals)
    return () => {
      cancelAnimationFrame(rafId)
      // Reset styles on all track headers
      if (container) {
        const elements = container.querySelectorAll<HTMLElement>('[data-track-id]')
        for (const el of elements) {
          el.style.transform = ''
          el.style.zIndex = ''
          el.style.opacity = ''
          el.style.transition = ''
          el.style.boxShadow = ''
        }
      }
      // Reset styles on the clip rows
      for (const el of getContentRows()) {
        el.style.transform = ''
        el.style.zIndex = ''
        el.style.opacity = ''
        el.style.transition = ''
      }
    }
  }, [isTrackDragging])

  // Keyboard shortcut: Escape exits the active composition.
  // In/out shortcuts are registered by useTimelineShortcuts so they remain
  // available when the compact Color timeline replaces this component.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Another focused panel (e.g. Source Monitor) already handled this key.
      if (e.defaultPrevented) return

      // Ignore if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      const key = e.key.toLowerCase()

      // Escape - exit composition if inside one
      if (key === 'escape' && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        const navStore = useCompositionNavigationStore.getState()
        if (navStore.activeCompositionId !== null) {
          e.preventDefault()
          navStore.exitComposition()
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const syncTrackSelectionAfterRemoval = useCallback(
    (removedTrackIds: string[], fallbackTrackId: string | null) => {
      const removedTrackIdsSet = new Set(removedTrackIds)
      const selectionState = useSelectionStore.getState()
      const remainingSelectedTrackIds = selectionState.selectedTrackIds.filter(
        (trackId) => !removedTrackIdsSet.has(trackId),
      )

      if (remainingSelectedTrackIds.length > 0) {
        selectionState.selectTracks(remainingSelectedTrackIds)
        return
      }

      if (selectionState.activeTrackId && !removedTrackIdsSet.has(selectionState.activeTrackId)) {
        return
      }

      selectionState.setActiveTrack(fallbackTrackId)
    },
    [],
  )

  const addVideoTrackToTop = useCallback(() => {
    const newTrack = createClassicTrack({ tracks, kind: 'video', order: 0 })

    addTrack(newTrack)

    setTimeout(() => {
      setActiveTrack(newTrack.id)
    }, 0)
  }, [addTrack, setActiveTrack, tracks])

  const appendAudioTrackToSection = useCallback(() => {
    const audioAnchorTrack =
      audioTracks[audioTracks.length - 1] ??
      videoTracks[videoTracks.length - 1] ??
      tracks[tracks.length - 1] ??
      null

    const newTrack = createClassicTrack({
      tracks,
      kind: 'audio',
      order: audioAnchorTrack ? getAdjacentTrackOrder(tracks, audioAnchorTrack, 'below') : 0,
    })

    setTimelineTracks([...tracks, newTrack])

    setTimeout(() => {
      setActiveTrack(newTrack.id)
    }, 0)
  }, [audioTracks, setActiveTrack, setTimelineTracks, tracks, videoTracks])

  // Trigger reflects the persisted preset (saved as a local editor setting).
  const ActiveTrackSizeIcon =
    TRACK_SIZE_OPTIONS.find((option) => option.id === trackSizePreset)?.icon ?? Rows3

  /**
   * Apply a track-size preset: save the choice locally and re-derive every
   * track's height from it, dropping any per-track overrides. Not a project
   * edit — no undo entry, no dirty flag.
   */
  const handleSelectTrackSize = useCallback((preset: (typeof TRACK_SIZE_OPTIONS)[number]) => {
    applyTrackSizePreset(preset.id)
  }, [])

  const handleToggleTrackPreview = useCallback(() => {
    toggleTrackPreviewCollapsed()
  }, [])

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      if (tracks.length <= 1) {
        logger.warn('Cannot remove all tracks')
        return
      }

      removeTracks([trackId])

      const remainingTracks = tracks.filter((track) => track.id !== trackId)
      syncTrackSelectionAfterRemoval([trackId], remainingTracks[0]?.id ?? null)
    },
    [removeTracks, syncTrackSelectionAfterRemoval, tracks],
  )

  const handleDeleteEmptyTracks = useCallback(
    (contextTrackId: string) => {
      const emptyTrackIds = getEmptyTrackIdsForRemoval(
        tracks,
        useItemsStore.getState().itemsByTrackId,
        contextTrackId,
      )
      if (emptyTrackIds.length === 0) return

      const removedTrackIdsSet = new Set(emptyTrackIds)
      removeTracks(emptyTrackIds)

      const remainingTracks = tracks.filter((track) => !removedTrackIdsSet.has(track.id))
      syncTrackSelectionAfterRemoval(emptyTrackIds, remainingTracks[0]?.id ?? null)
    },
    [removeTracks, syncTrackSelectionAfterRemoval, tracks],
  )

  /**
   * Handle removing selected tracks
   * Removes all selected tracks or the active track if none selected.
   * Keeps at least one track in the timeline.
   */
  const handleRemoveTracks = useCallback(() => {
    const tracksToRemove =
      selectedTrackIds.length > 0 ? [...selectedTrackIds] : activeTrackId ? [activeTrackId] : []

    if (tracksToRemove.length === 0) return

    // Don't allow removing all tracks
    const tracksToRemoveSet = new Set(tracksToRemove)
    if (tracksToRemoveSet.size >= tracks.length) {
      logger.warn('Cannot remove all tracks')
      return
    }

    removeTracks(tracksToRemove)

    const remainingTrack = tracks.find((t) => !tracksToRemoveSet.has(t.id))
    syncTrackSelectionAfterRemoval(tracksToRemove, remainingTrack?.id ?? null)
  }, [activeTrackId, removeTracks, selectedTrackIds, syncTrackSelectionAfterRemoval, tracks])

  const videoDropIndicatorIndex =
    isTrackDragging && dropIndicatorIndex >= 0 && dropIndicatorIndex <= videoTracks.length
      ? dropIndicatorIndex
      : -1
  const audioDropIndicatorIndex =
    isTrackDragging &&
    dropIndicatorIndex >= videoTracks.length &&
    dropIndicatorIndex <= visibleTracks.length
      ? dropIndicatorIndex - videoTracks.length
      : -1

  const renderTrackHeadersSection = (
    sectionTracks: typeof visibleTracks,
    options: {
      section: 'video' | 'audio'
      zoneHeight: number
      dropIndicatorLocalIndex: number
      firstTrackFrame: 'with-top-divider' | 'regular'
    },
  ) => (
    <div className="relative" data-track-section={options.section}>
      {options.section === 'video' && (
        <div
          aria-hidden="true"
          data-track-header-new-zone="video"
          style={{ height: `${options.zoneHeight}px` }}
        />
      )}

          {sectionTracks.map((track, index) => {
            const RowFrame =
              options.firstTrackFrame === 'with-top-divider' && index === 0
                ? FirstTrackRowFrame
                : TrackRowFrame
            return (
              <RowFrame
                key={track.id}
                onResizeMouseDown={(event) => handleTrackResizeStart(event, track.id)}
                onResizeDoubleClick={(event) => handleTrackResizeReset(event, track.id)}
                resizeHandleLabel={`Resize ${track.name} height`}
                resizeHandlePosition={getTrackKind(track) === 'video' ? 'top' : 'bottom'}
              >
                <TrackHeader
                  track={track}
                  isActive={activeTrackId === track.id}
                  isSelected={selectedTrackIdsSet.has(track.id)}
                  canDeleteTrack={tracks.length > 1}
                  canDeleteEmptyTracks={canDeleteEmptyTracks}
                  onToggleLock={() => toggleTrackLock(track.id)}
                  onToggleSyncLock={() => toggleTrackSyncLock(track.id)}
                  onToggleDisabled={() => toggleTrackDisabled(track.id)}
                  onToggleSolo={() => toggleTrackSolo(track.id)}
                  onCloseGaps={() => useTimelineStore.getState().closeAllGapsOnTrack(track.id)}
                  onAddVideoTrack={addVideoTrackToTop}
                  onAddAudioTrack={appendAudioTrackToSection}
                  onDeleteTrack={() => handleDeleteTrack(track.id)}
                  onDeleteEmptyTracks={() => handleDeleteEmptyTracks(track.id)}
                  onSelect={(e) => {
                    if (trackDragJustDroppedRef.current) return
                    if (e.shiftKey && activeTrackId) {
                      const startIdx = visibleTracks.findIndex((t) => t.id === activeTrackId)
                      const endIdx = visibleTracks.findIndex((t) => t.id === track.id)
                      if (startIdx !== -1 && endIdx !== -1) {
                        const lo = Math.min(startIdx, endIdx)
                        const hi = Math.max(startIdx, endIdx)
                        const rangeIds = visibleTracks.slice(lo, hi + 1).map((t) => t.id)
                        selectTracks(rangeIds)
                      }
                    } else if (e.metaKey || e.ctrlKey) {
                      toggleTrackSelection(track.id)
                    } else {
                      setActiveTrack(track.id)
                    }
                  }}
                />
              </RowFrame>
            )
          })}

      {options.section === 'audio' && (
        <div
          aria-hidden="true"
          data-track-header-new-zone="audio"
          style={{ height: `${options.zoneHeight}px` }}
        />
      )}

      {options.dropIndicatorLocalIndex >= 0 && (
        <div
          className="absolute left-0 right-0 h-0.5 pointer-events-none z-50 shadow-lg bg-primary"
          style={{
            top: getTrackStackOffset(
              sectionTracks,
              options.dropIndicatorLocalIndex,
              options.section === 'video' ? options.zoneHeight : 0,
            ),
          }}
        />
      )}
    </div>
  )

  return (
    <div
      className="timeline-bg editor-toolbar-theme h-full border-t border-border flex flex-col overflow-hidden"
      role="region"
      aria-label={t('timeline.region')}
    >
      {/* Timeline Header */}
      <TimelineHeader
        onZoomChange={zoomHandlers?.handleZoomChange}
        onZoomIn={zoomHandlers?.handleZoomIn}
        onZoomOut={zoomHandlers?.handleZoomOut}
        onZoomToFit={zoomHandlers?.handleZoomToFit}
        leadingContent={<SequenceTabs compact />}
      />

      {/* Composition Breadcrumbs - shown when inside a sub-composition */}
      <CompositionBreadcrumbs />

      {/* Timeline Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Track Headers Sidebar */}
        <div
          className="border-r border-border panel-bg flex-shrink-0 flex flex-col overflow-x-hidden"
          style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineSidebarWidth }}
        >
          {/* Tracks label with controls */}
          <div
            className="flex items-center justify-between px-3 border-b border-border bg-secondary/20 flex-shrink-0"
            style={{ height: EDITOR_LAYOUT_CSS_VALUES.timelineTracksHeaderHeight }}
          >
            <Button
              variant="ghost"
              size="icon"
              className={`editor-toolbar-button h-6 w-6 ${trackPreviewCollapsed ? 'editor-toolbar-button-active' : ''}`}
              aria-pressed={trackPreviewCollapsed}
              onClick={handleToggleTrackPreview}
              title={t(
                trackPreviewCollapsed
                  ? 'timeline.trackSize.showPreview'
                  : 'timeline.trackSize.hidePreview',
              )}
            >
              {trackPreviewCollapsed ? (
                <PanelTopOpen className="h-3.5 w-3.5" />
              ) : (
                <PanelTopClose className="h-3.5 w-3.5" />
              )}
            </Button>
            {/* Track size flyout */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="editor-toolbar-button h-6 w-6"
                  title={t('timeline.trackSize.label')}
                >
                  <ActiveTrackSizeIcon className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[10rem]">
                {TRACK_SIZE_OPTIONS.map((option) => {
                  const OptionIcon = option.icon
                  const isActive = trackSizePreset === option.id
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      onSelect={() => handleSelectTrackSize(option)}
                    >
                      <OptionIcon className="w-4 h-4" />
                      <span className="flex-1">{t(option.labelKey)}</span>
                      {isActive ? <Check className="w-4 h-4" /> : null}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center gap-1">
              {/* Add track flyout */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="editor-toolbar-button h-6 w-6"
                    title={t('timeline.addTrack.label')}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[10rem]">
                  <DropdownMenuItem onSelect={() => addVideoTrackToTop()}>
                    <Video className="w-4 h-4" />
                    <span className="flex-1">{t('timeline.addTrack.video')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => appendAudioTrackToSection()}>
                    <AudioLines className="w-4 h-4" />
                    <span className="flex-1">{t('timeline.addTrack.audio')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {/* Remove track button */}
              <Button
                variant="ghost"
                size="icon"
                className="editor-toolbar-button h-6 w-6"
                onClick={handleRemoveTracks}
                disabled={tracks.length === 0 || (!activeTrackId && selectedTrackIds.length === 0)}
                title={
                  tracks.length === 0
                    ? t('timeline.noTracksToRemove')
                    : !activeTrackId && selectedTrackIds.length === 0
                      ? t('timeline.selectTrackToRemove')
                      : selectedTrackIds.length > 0
                        ? t('timeline.removeSelectedTracks', { count: selectedTrackIds.length })
                        : t('timeline.removeActiveTrack')
                }
              >
                <Minus className="w-3 h-3" />
              </Button>
            </div>
          </div>

          {/* Track labels - synced scroll (no scrollbar) */}
          <div ref={trackHeadersViewportRef} className="flex-1 overflow-hidden relative">
            <div
              ref={trackHeadersRootRef}
              className="flex h-full min-h-0 flex-col"
            >
              <div
                ref={allTrackHeadersScrollRef}
                data-track-section-scroll="all"
                className="h-full overflow-hidden"
              >
                <div className="relative min-h-full">
                  {renderTrackHeadersSection(videoTracks, {
                    section: 'video',
                    zoneHeight: videoZoneHeight,
                    dropIndicatorLocalIndex: videoDropIndicatorIndex,
                    firstTrackFrame: 'with-top-divider',
                  })}
                  {renderTrackHeadersSection(audioTracks, {
                    section: 'audio',
                    zoneHeight: audioZoneHeight,
                    dropIndicatorLocalIndex: audioDropIndicatorIndex,
                    firstTrackFrame: videoTracks.length > 0 ? 'regular' : 'with-top-divider',
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline Canvas */}
        <TimelineContent
          duration={duration}
          tracks={visibleTracks}
          scrollRef={timelineContentRef}
          allTracksScrollRef={allTrackContentScrollRef}
          onZoomHandlersReady={setZoomHandlers}
        />
      </div>

      <div className="flex flex-shrink-0 overflow-hidden">
        <div
          className="border-r border-border panel-bg flex-shrink-0"
          style={{ width: EDITOR_LAYOUT_CSS_VALUES.timelineSidebarWidth }}
        />
        <div className="flex-1 min-w-0">
          <TimelineNavigator actualDuration={duration} scrollContainerRef={timelineContentRef} />
        </div>
      </div>
      <KeyframeGraphPanel
        isOpen={keyframePanelOpen}
        placement="bottom"
        surface="edit"
        propertyColumnWidth={editorLayout.timelineSidebarWidth - 1}
        timelineScrollContainerRef={timelineContentRef}
        onClose={() => setKeyframePanelOpen(false)}
      />
      <TransitionDragTooltip />
    </div>
  )
})
