import './live-photo-badge.css'

interface LivePhotoBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** 徽章直径（默认 36） */
  size?: number
}

/**
 * 统一 Live Photo 标识徽章
 * 仿 iOS Live Photo 环形白色点阵 + 同心圆，透明背景。
 * 在媒体库卡片、工作台缩略图、预览弹窗中使用。
 */
export function LivePhotoBadge({ size = 36, className, style, ...spanProps }: LivePhotoBadgeProps) {
  const symbolSize = Math.round(size * 0.67)
  const ring1 = Math.round(symbolSize * 0.23)
  const ring2 = Math.round(symbolSize * 0.35)
  const center = (symbolSize - 2) / 2
  return (
    <span
      className={`live-photo-badge${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, ...(style as React.CSSProperties) }}
      {...spanProps}
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
