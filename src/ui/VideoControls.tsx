import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { Slider as RadixSlider } from 'radix-ui'

import { IconButton } from './IconButton'
import { cx } from './utils'

export interface VideoControlsProps {
  playing: boolean
  currentTime: number
  duration: number
  onToggle: () => void
  onSeek: (time: number) => void
  onSeekStart?: () => void
  onSeekEnd?: () => void
  muted?: boolean
  onToggleMute?: () => void
  step?: number
  className?: string
  disabled?: boolean
}

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = Math.floor(safeSeconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

export function VideoControls({
  playing,
  currentTime,
  duration,
  onToggle,
  onSeek,
  onSeekStart,
  onSeekEnd,
  muted = false,
  onToggleMute,
  step = 0.1,
  className,
  disabled = false,
}: VideoControlsProps) {
  return (
    <div
      className={cx('ui-video-controls', className)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <IconButton
        className="ui-video-controls-button"
        variant="ghost"
        size="mini"
        icon={playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        disabled={disabled}
        onClick={onToggle}
        title={playing ? '暂停' : '播放'}
        aria-label={playing ? '暂停' : '播放'}
      />
      <RadixSlider.Root
        className="ui-video-controls-progress"
        min={0}
        max={duration > 0 ? duration : 1}
        step={step}
        value={[duration > 0 ? Math.min(currentTime, duration) : 0]}
        disabled={disabled || duration <= 0}
        onValueChange={([time]) => onSeek(time)}
        onValueCommit={onSeekEnd}
        onPointerDown={onSeekStart}
      >
        <RadixSlider.Track className="ui-video-controls-track">
          <RadixSlider.Range className="ui-video-controls-range" />
        </RadixSlider.Track>
        <RadixSlider.Thumb className="ui-video-controls-thumb" aria-label="视频进度" />
      </RadixSlider.Root>
      {onToggleMute && (
        <IconButton
          className="ui-video-controls-button ui-video-controls-mute-button"
          variant="ghost"
          size="mini"
          icon={muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          disabled={disabled}
          onClick={onToggleMute}
          title={muted ? '打开声音' : '关闭声音'}
          aria-label={muted ? '打开声音' : '关闭声音'}
          aria-pressed={muted}
        />
      )}
      <span className="ui-video-controls-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
