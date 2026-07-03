import { Pause, Play } from 'lucide-react'

interface WorkspaceVideoControlsProps {
  playing: boolean
  currentTime: number
  duration: number
  onToggle: () => void
  onSeek: (time: number) => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function WorkspaceVideoControls({
  playing,
  currentTime,
  duration,
  onToggle,
  onSeek,
}: WorkspaceVideoControlsProps) {
  return (
    <div className="workspace-video-controls" onClick={(event) => event.stopPropagation()}>
      <button
        className="workspace-video-btn"
        type="button"
        onClick={onToggle}
        aria-label={playing ? '暂停' : '播放'}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <input
        className="workspace-video-progress"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={currentTime}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="进度"
      />
      <span className="workspace-video-time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  )
}
