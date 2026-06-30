import { useEffect, useRef } from 'react'
import { Dialog as RadixDialog } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { acquireIndex, contentZ, overlayZ, releaseIndex } from './zIndexManager'

/* ==================== Sub-components (internal, not exported) ==================== */

function DialogOverlay({ style, ...props }: RadixDialog.DialogOverlayProps & { style?: React.CSSProperties }) {
  return <RadixDialog.Overlay className="ui-dialog-overlay" style={style} {...props} />
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
  /**
   * 视觉变体：
   * - `'dialog'`（默认）：居中弹窗，带标题/描述/底部操作栏/关闭按钮
   * - `'fullscreen'`：全屏弹窗，由内容自行管理布局（用于 PreviewModal / ExportModal）
   */
  variant?: 'dialog' | 'fullscreen'
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
  variant = 'dialog',
}: DialogProps) {
  const zRef = useRef<{ id: string; zIndex: number } | null>(null)

  // 弹窗打开时获取递增 z-index
  useEffect(() => {
    if (open && !zRef.current) {
      zRef.current = acquireIndex()
    } else if (!open && zRef.current) {
      releaseIndex(zRef.current.id)
      zRef.current = null
    }
  }, [open])

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      if (zRef.current) releaseIndex(zRef.current.id)
    }
  }, [])

  const zIndex = zRef.current?.zIndex ?? 0
  const oZ = overlayZ(zIndex)
  const cZ = contentZ(zIndex)
  const isFullscreen = variant === 'fullscreen'

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange} defaultOpen={defaultOpen}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <DialogOverlay style={{ zIndex: oZ }} />
        <RadixDialog.Content
          className={`ui-dialog-content ${isFullscreen ? 'ui-dialog-fullscreen' : ''} ${className ?? ''}`}
          style={{ zIndex: cZ }}
        >
          {!isFullscreen && title && (
            <DialogHeader>
              <RadixDialog.Title>{title}</RadixDialog.Title>
              {description && <RadixDialog.Description>{description}</RadixDialog.Description>}
            </DialogHeader>
          )}
          {children}
          {!isFullscreen && footer && <DialogFooter>{footer}</DialogFooter>}
          {!isFullscreen && (
            <RadixDialog.Close asChild>
              <button className="ui-dialog-close" aria-label="关闭">
                <X size={18} />
              </button>
            </RadixDialog.Close>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
