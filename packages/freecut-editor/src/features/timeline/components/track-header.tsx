import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@freecut/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@freecut/components/ui/context-menu'
import {
  AudioLines,
  Eye,
  EyeOff,
  Film,
  Lock,
  Volume2,
  VolumeX,
} from 'lucide-react'
import type { TimelineTrack } from '@freecut/types/timeline'
import { useTrackDrag } from '../hooks/use-track-drag'
import { TIMELINE_SIDEBAR_WIDTH } from '../constants'
import { EDITOR_LAYOUT_CSS_VALUES } from '@freecut/config/editor-layout'
import { isTrackDisabled } from '@freecut/features/timeline/utils/classic-tracks'
import { isTrackSyncLockActive } from '../utils/track-sync-lock'

interface TrackHeaderProps {
  track: TimelineTrack
  isActive: boolean
  isSelected: boolean
  canDeleteTrack: boolean
  canDeleteEmptyTracks: boolean
  onToggleLock: () => void
  onToggleSyncLock: () => void
  onToggleDisabled: () => void
  onToggleSolo: () => void
  onSelect: (e: React.MouseEvent) => void
  onCloseGaps?: () => void
  onAddVideoTrack: () => void
  onAddAudioTrack: () => void
  onDeleteTrack: () => void
  onDeleteEmptyTracks: () => void
}

/**
 * Custom equality for TrackHeader memo - ignores callback props which are recreated each render
 */
function areTrackHeaderPropsEqual(prev: TrackHeaderProps, next: TrackHeaderProps): boolean {
  return (
    prev.track === next.track &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.canDeleteTrack === next.canDeleteTrack &&
    prev.canDeleteEmptyTracks === next.canDeleteEmptyTracks
  )
  // Callbacks (onToggleLock, etc.) are ignored - they're recreated each render but functionality is same
}

/**
 * Track Header Component
 *
 * Displays track name, controls, and handles selection.
 * Shows active state with background color.
 * Supports group tracks with collapse/expand and indentation.
 * Right-click context menu for track actions.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const TrackHeader = memo(function TrackHeader({
  track,
  isActive,
  isSelected,
  canDeleteTrack,
  canDeleteEmptyTracks,
  onToggleLock,
  onToggleSyncLock,
  onToggleDisabled,
  onToggleSolo,
  onSelect,
  onCloseGaps,
  onAddVideoTrack,
  onAddAudioTrack,
  onDeleteTrack,
  onDeleteEmptyTracks,
}: TrackHeaderProps) {
  const { t } = useTranslation()
  const syncLockEnabled = isTrackSyncLockActive(track)
  const trackDisabled = isTrackDisabled(track)
  const isAudioTrack = track.kind === 'audio'
  const TrackKindIcon = isAudioTrack ? AudioLines : Film
  const TrackEnabledIcon = isAudioTrack ? Volume2 : Eye
  const TrackDisabledIcon = isAudioTrack ? VolumeX : EyeOff

  // Use track drag hook (visuals handled centrally by timeline.tsx via DOM)
  const { handleDragStart } = useTrackDrag(track)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="relative overflow-hidden"
          style={{
            height: `${track.height}px`,
            contentVisibility: 'auto',
            containIntrinsicSize: `${TIMELINE_SIDEBAR_WIDTH}px ${track.height}px`,
          }}
          data-track-id={track.id}
          data-track-disabled={trackDisabled ? 'true' : undefined}
        >
          <div
            className={`
              flex items-center gap-1 overflow-hidden px-1.5
              cursor-grab active:cursor-grabbing relative
              ${isSelected ? 'bg-primary/10' : trackDisabled ? 'bg-muted/30 hover:bg-muted/40' : 'hover:bg-secondary/50'}
              ${isActive ? 'border-l-3 border-l-primary' : 'border-l-3 border-l-transparent'}
              ${trackDisabled ? 'text-muted-foreground' : ''}
              transition-colors duration-150
            `}
            style={{ height: `${track.height}px` }}
            onClick={onSelect}
            onMouseDown={handleDragStart}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-0.5">
              <div className="flex h-5 w-4 shrink-0 items-center justify-center text-muted-foreground">
                <TrackKindIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </div>
              <span className="min-w-0 truncate text-[11px] font-medium leading-none">
                {track.name}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {/* Lock Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLock()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  track.locked
                    ? t('timeline.trackHeader.unlockTrack')
                    : t('timeline.trackHeader.lockTrack')
                }
                data-tooltip={
                  track.locked
                    ? t('timeline.trackHeader.unlockTrack')
                    : t('timeline.trackHeader.lockTrack')
                }
              >
                <Lock className={`h-3 w-3 ${track.locked ? 'text-primary' : 'opacity-70'}`} />
              </Button>

              {/* Disable Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleDisabled()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  trackDisabled
                    ? t('timeline.trackHeader.enableTrack')
                    : t('timeline.trackHeader.disableTrack')
                }
                data-tooltip={
                  trackDisabled
                    ? t('timeline.trackHeader.enableTrack')
                    : t('timeline.trackHeader.disableTrack')
                }
              >
                {trackDisabled ? (
                  <TrackDisabledIcon className="h-3 w-3 text-primary" />
                ) : (
                  <TrackEnabledIcon className="h-3 w-3 opacity-70" />
                )}
              </Button>

              {/* Solo Button */}
              <Button
                variant="ghost"
                size="icon"
                className="rounded hover:bg-secondary"
                style={{
                  width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                  height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleSolo()
                }}
                onMouseDown={(e) => e.stopPropagation()}
                aria-label={
                  track.solo
                    ? t('timeline.trackHeader.unsoloTrack')
                    : t('timeline.trackHeader.soloTrack')
                }
                data-tooltip={
                  track.solo
                    ? t('timeline.trackHeader.unsoloTrack')
                    : t('timeline.trackHeader.soloTrack')
                }
              >
                <span
                  className={`text-[10px] font-semibold leading-none ${track.solo ? 'text-primary' : 'opacity-70'}`}
                >
                  S
                </span>
              </Button>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onToggleSyncLock}>
          {syncLockEnabled
            ? t('timeline.trackHeader.disableSyncLock')
            : t('timeline.trackHeader.enableSyncLock')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseGaps}>
          {t('timeline.trackHeader.closeAllGaps')}
        </ContextMenuItem>

        <ContextMenuSeparator />
        <ContextMenuItem onClick={onAddVideoTrack}>
          {t('timeline.trackHeader.addVideoTrack')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onAddAudioTrack}>
          {t('timeline.trackHeader.addAudioTrack')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!canDeleteTrack} onClick={onDeleteTrack}>
          {t('timeline.trackHeader.deleteTrack')}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDeleteEmptyTracks} onClick={onDeleteEmptyTracks}>
          {t('timeline.trackHeader.deleteEmptyTracks')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}, areTrackHeaderPropsEqual)
