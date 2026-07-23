import { Play } from 'lucide-react'
import './video-play-badge.css'

interface VideoPlayBadgeProps {
  /** 徽章直径（默认 22） */
  size?: number
  className?: string
}

/**
 * 统一视频播放图标徽章
 * 在媒体库卡片、预览弹窗缩略图、工作台缩略图中使用。
 */
export function VideoPlayBadge({ size = 22, className }: VideoPlayBadgeProps) {
  const iconSize = Math.max(8, Math.round(size * 0.45))
  return (
    <span
      className={`video-play-badge${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      <Play size={iconSize} fill="currentColor" />
    </span>
  )
}
