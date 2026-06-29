import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/* ==================== Sub-components (internal, not exported) ==================== */

function DialogOverlay({ className, ...props }: RadixDialog.DialogOverlayProps) {
  return <RadixDialog.Overlay className={`ui-dialog-overlay ${className ?? ''}`} {...props} />
}

function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ui-dialog-header ${className ?? ''}`}>{children}</div>
}

function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`ui-dialog-footer ${className ?? ''}`}>{children}</div>
}

/* ==================== Unified Dialog ==================== */

export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  /** 触发按钮（未受控模式） */
  trigger?: ReactNode
  /** 弹窗标题 */
  title?: ReactNode
  /** 弹窗描述 */
  description?: ReactNode
  /** 主体内容 */
  children?: ReactNode
  /** 底部操作栏 */
  footer?: ReactNode
  /** DialogContent 自定义类名 */
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  defaultOpen,
  trigger,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <DialogOverlay />
        <RadixDialog.Content className={`ui-dialog-content ${className ?? ''}`}>
          {title && (
            <DialogHeader>
              <RadixDialog.Title>{title}</RadixDialog.Title>
              {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
            </DialogHeader>
          )}
          {children}
          {footer && <DialogFooter>{footer}</DialogFooter>}
          <RadixDialog.Close asChild>
            <button className="ui-dialog-close" aria-label="关闭">
              <X size={18} />
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
