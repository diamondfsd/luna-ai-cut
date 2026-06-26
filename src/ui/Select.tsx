import { type ReactNode } from 'react'
import * as RadixSelect from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from './utils'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  /** 主题（与 Input 保持一致）：
   *  - pill（默认）：标准 44px 圆角下拉
   *  - compact：紧凑 32px 圆角下拉，用于面板内
   *  - ghost：无边框透明下拉
   */
  variant?: 'pill' | 'compact' | 'ghost'
  /** 选项列表 */
  options: SelectOption[]
  /** 前置图标 */
  icon?: ReactNode
  /** 占位文本（无选中值时显示） */
  placeholder?: string
  /** 当前选中值 */
  value?: string
  /** 默认值 */
  defaultValue?: string
  /** 选中变化回调 */
  onValueChange?: (value: string) => void
  /** 宽度撑满父容器 */
  fullWidth?: boolean
  /** 禁用状态 */
  disabled?: boolean
  /** 额外 class */
  className?: string
}

/**
 * 下拉选择器 — 基于 @radix-ui/react-select
 *
 * 用法：
 * ```tsx
 * <Select
 *   variant="compact"
 *   options={[{value:'a',label:'A'},{value:'b',label:'B'}]}
 *   placeholder="请选择"
 *   icon={<Camera size={14} />}
 * />
 * ```
 */
export function Select({
  variant = 'pill',
  options,
  icon,
  placeholder,
  value,
  defaultValue,
  onValueChange,
  fullWidth,
  disabled,
  className,
}: SelectProps) {
  return (
    <RadixSelect.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        className={cx('ui-select-trigger', `ui-select-${variant}`, fullWidth && 'ui-select-full', className)}
        aria-label={placeholder}
      >
        {icon && <span className="ui-select-icon">{icon}</span>}
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="ui-select-chevron">
          <ChevronDown size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          className={cx('ui-select-content', `ui-select-content-${variant}`)}
          position="popper"
          sideOffset={4}
        >
          <RadixSelect.Viewport className="ui-select-viewport">
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} value={opt.value} className="ui-select-item">
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ui-select-item-indicator">
                  <Check size={12} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
