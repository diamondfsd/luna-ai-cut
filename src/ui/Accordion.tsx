import { type ReactNode } from 'react'
import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { cx } from './utils'

interface AccordionProps {
  /** 标题 */
  title: ReactNode
  /** 内容 */
  children: ReactNode
  /** 是否默认展开 */
  defaultOpen?: boolean
  /** 受控展开状态 */
  open?: boolean
  /** 展开状态变化回调 */
  onOpenChange?: (open: boolean) => void
  /** 标题区域的额外 class */
  headerClassName?: string
  /** 额外 class */
  className?: string
}

/**
 * 手风琴折叠面板 — 基于 @radix-ui/react-collapsible
 *
 * 用法：
 * ```tsx
 * <Accordion title="水印设置" defaultOpen>
 *   <WatermarkSettings ... />
 * </Accordion>
 *
 * // 受控模式
 * const [open, setOpen] = useState(false)
 * <Accordion title="设置" open={open} onOpenChange={setOpen}>
 *   ...
 * </Accordion>
 * ```
 */
export function Accordion({ title, children, defaultOpen, open, onOpenChange, headerClassName, className }: AccordionProps) {
  return (
    <Collapsible.Root
      className={cx('ui-accordion', className)}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
    >
      <Collapsible.Trigger asChild>
        <button className={cx('ui-accordion-header', headerClassName)} type="button">
          <span className="ui-accordion-title">{title}</span>
          <ChevronDown size={14} className="ui-accordion-chevron" />
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content className="ui-accordion-body">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
