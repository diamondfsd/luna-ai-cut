import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

/* ==================== Root ==================== */
export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger

/* ==================== Portal + Overlay ==================== */
export function DialogOverlay({ className, ...props }: RadixDialog.DialogOverlayProps) {
  return <RadixDialog.Overlay className={`ui-dialog-overlay ${className ?? ''}`} {...props} />
}

/* ==================== Content ==================== */
export function DialogContent({ children, className, ...props }: RadixDialog.DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <DialogOverlay />
      <RadixDialog.Content className={`ui-dialog-content ${className ?? ''}`} {...props}>
        {children}
        <RadixDialog.Close asChild>
          <button className="ui-dialog-close" aria-label="关闭">
            <X size={18} />
          </button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

/* ==================== Header / Body / Footer ==================== */

interface DialogHeaderProps {
  children: ReactNode
  className?: string
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return <div className={`ui-dialog-header ${className ?? ''}`}>{children}</div>
}

interface DialogBodyProps {
  children: ReactNode
  className?: string
}

export function DialogBody({ children, className }: DialogBodyProps) {
  return <div className={`ui-dialog-body ${className ?? ''}`}>{children}</div>
}

interface DialogFooterProps {
  children: ReactNode
  className?: string
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={`ui-dialog-footer ${className ?? ''}`}>{children}</div>
}

/* ==================== Title & Description ==================== */
export const DialogTitle = RadixDialog.Title
export const DialogDescription = RadixDialog.Description
