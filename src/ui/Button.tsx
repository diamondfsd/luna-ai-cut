import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './utils'

export type ButtonVariant = 'primary' | 'secondary' | 'utility' | 'ghost' | 'danger'
export type ButtonSize = 'default' | 'compact' | 'mini'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 主题：
   *  - primary（推荐）：蓝色实心圆角，用于主要操作（保存、连接、创建）
   *  - secondary（默认）：蓝色边框透明，用于次要操作（取消、重置）
   *  - utility：深色矩形按钮，用于工具类操作
   *  - ghost：文字按钮，用于低强调操作
   *  - danger：红色提示按钮，用于删除等销毁操作
   */
  variant?: ButtonVariant
  /** 尺寸：
   *  - default（默认）：标准高度 36px
   *  - compact：紧凑高度 32px
   *  - mini：最小高度 28px，用于内联操作
   */
  size?: ButtonSize
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary',
  size = 'default',
  icon,
  children,
  className,
  type = 'button',
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        'ui-btn',
        `ui-btn-${variant}`,
        size !== 'default' && `ui-btn-${size}`,
        className,
      )}
      type={type}
      {...props}
    >
      {icon && <span className="ui-btn-icon">{icon}</span>}
      {children}
    </button>
  )
})
