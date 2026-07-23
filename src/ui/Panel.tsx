import { forwardRef, type ReactNode, type HTMLAttributes } from 'react'
import { cx } from './utils'

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** 面板主题 */
  variant?: 'default' | 'dark'
}

/**
 * 通用弹出面板容器。
 * 配合 PanelHeader / PanelBody / PanelFooter 使用，提供一致的间距和圆角。
 *
 * @example
 * ```tsx
 * <Panel variant="dark">
 *   <PanelHeader>标题</PanelHeader>
 *   <PanelBody>内容</PanelBody>
 *   <PanelFooter>
 *     <Button>取消</Button>
 *     <Button variant="primary">确认</Button>
 *   </PanelFooter>
 * </Panel>
 * ```
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ children, className, variant = 'default', ...props }, ref) {
  return (
    <div ref={ref} className={cx('ui-panel', variant === 'dark' && 'ui-panel-dark', className)} {...props}>
      {children}
    </div>
  )
})

interface PanelHeaderProps {
  children: ReactNode
  className?: string
}

export function PanelHeader({ children, className }: PanelHeaderProps) {
  return (
    <div className={cx('ui-panel-header', className)}>
      {children}
    </div>
  )
}

interface PanelBodyProps {
  children: ReactNode
  className?: string
}

export function PanelBody({ children, className }: PanelBodyProps) {
  return (
    <div className={cx('ui-panel-body', className)}>
      {children}
    </div>
  )
}

interface PanelFooterProps {
  children: ReactNode
  className?: string
}

export function PanelFooter({ children, className }: PanelFooterProps) {
  return (
    <div className={cx('ui-panel-footer', className)}>
      {children}
    </div>
  )
}
