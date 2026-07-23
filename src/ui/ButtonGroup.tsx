import type { ReactNode } from 'react'
import { cx } from './utils'

interface ButtonGroupOption<T extends string> {
  value: T
  label: ReactNode
}

interface ButtonGroupProps<T extends string> {
  options: Array<ButtonGroupOption<T>>
  value: T
  onChange: (value: T) => void
  className?: string
}

/**
 * 文字按钮组 — 单选中，选中态蓝色文字，未选中灰色文字
 * 类似 landing page 的标签切换风格
 */
export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className,
}: ButtonGroupProps<T>) {
  return (
    <div className={cx('ui-btn-group', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          className={cx('ui-btn-group-btn', value === option.value && 'active')}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
