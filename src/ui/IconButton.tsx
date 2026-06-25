import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './utils'

export type IconButtonVariant = 'circle' | 'light' | 'outline' | 'ghost'
export type IconButtonSize = 'default' | 'compact' | 'mini'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 主题：
   *  - circle（默认）：带背景的圆形按钮，用于关闭/设置
   *  - light：深色背景上的圆形按钮，用于预览弹窗
   *  - outline：带蓝色边框的圆形图标按钮
   *  - ghost：透明圆形按钮，最小视觉干扰
   */
  variant?: IconButtonVariant
  /** 尺寸：
   *  - default（默认）：44px
   *  - compact：32px
   *  - mini：28px
   */
  size?: IconButtonSize
  icon: ReactNode
}

export function IconButton({
  variant = 'circle',
  size = 'default',
  icon,
  className,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      className={cx(
        'ui-icon-btn',
        `ui-icon-btn-${variant}`,
        size !== 'default' && `ui-icon-btn-${size}`,
        className,
      )}
      type={type}
      {...props}
    >
      {icon}
    </button>
  )
}
