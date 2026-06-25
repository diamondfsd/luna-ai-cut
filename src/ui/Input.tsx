import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cx } from './utils'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 主题：
   *  - pill（默认）：标准 44px 圆角输入框，用于设置页表单
   *  - compact：小型 32px 圆角输入框，用于内联标签编辑
   *  - ghost：无边框透明输入框，用于聊天/特殊场景
   */
  variant?: 'pill' | 'compact' | 'ghost'
  /** 前置图标（输入框内显示在左侧） */
  icon?: ReactNode
  /** wrapper 容器的额外 class（带图标时生效） */
  wrapperClassName?: string
  /** 宽度撑满父容器 */
  fullWidth?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { variant = 'pill', icon, wrapperClassName, fullWidth, className, ...props },
  ref,
) {
  if (icon) {
    return (
      <label className={cx('ui-input-wrap', fullWidth && 'ui-input-full', wrapperClassName)}>
        <span className="ui-input-icon">{icon}</span>
        <input
          ref={ref}
          className={cx('ui-input', `ui-input-${variant}`, fullWidth && 'ui-input-full', className)}
          {...props}
        />
      </label>
    )
  }

  return (
    <input
      ref={ref}
      className={cx('ui-input', `ui-input-${variant}`, fullWidth && 'ui-input-full', className)}
      {...props}
    />
  )
})
