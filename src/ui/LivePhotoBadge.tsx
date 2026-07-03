import './live-photo-badge.css'

interface LivePhotoBadgeProps {
  /** 徽章直径（默认 36） */
  size?: number
  className?: string
}

/**
 * 统一 Live Photo 标识徽章
 * 仿 iOS Live Photo 环形白色点阵 + 同心圆，透明背景。
 * 在媒体库卡片、工作台缩略图、预览弹窗中使用。
 */
export function LivePhotoBadge({ size = 36, className }: LivePhotoBadgeProps) {
  const symbolSize = Math.round(size * 0.67)
  // 同心圆 inset 按比例缩放，确保各尺寸下居中
  const ring1 = Math.round(symbolSize * 0.23)
  const ring2 = Math.round(symbolSize * 0.35)
  // 中心圆点：用 border 做小点，inset 需精确居中
  // 点可视大小 = 2px（2 个 1px border），居中 inset = (symbolSize - 2) / 2
  const center = (symbolSize - 2) / 2
  return (
    <span
      className={`live-photo-badge${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
      aria-label="Live Photo"
    >
      <span
        className="live-photo-badge-symbol"
        style={{ width: symbolSize, height: symbolSize }}
        aria-hidden="true"
      >
        <span style={{ inset: ring1 }} />
        <span style={{ inset: ring2 }} />
        <span style={{ inset: center }} />
      </span>
    </span>
  )
}
