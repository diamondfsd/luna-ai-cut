import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '.'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 弹窗标题 */
  title: ReactNode
  /** 弹窗描述（可选） */
  description?: ReactNode
  /** 弹窗主体内容 */
  children: ReactNode
  /**
   * 自定义底部按钮区域。
   * 未传时：如果提供了 onConfirm 则显示默认的「取消 + 确认」按钮，否则不显示底部。
   */
  footer?: ReactNode
  /** 确认回调（提供此 prop 时自动显示确认按钮） */
  onConfirm?: () => void
  /** 确认按钮文本（默认"确认"） */
  confirmText?: string
  /** 确认按钮 loading 状态 */
  confirmLoading?: boolean
  /** 确认按钮 disabled 状态 */
  confirmDisabled?: boolean
  /** 确认按钮样式（默认 primary） */
  confirmVariant?: 'primary' | 'danger'
  /** 取消按钮文本（默认"取消"） */
  cancelText?: string
}

/**
 * 简化弹窗组件。
 *
 * 基于 Radix Dialog，封装了标题 / 描述 / 主体 / 底部按钮的标准布局，
 * 调用方只需传内容，无需编写 DialogHeader / DialogBody / DialogFooter 等样板代码。
 *
 * 需要自定义布局时使用 BaseModal（全屏弹窗）或 ModalLayer（仅遮罩层）。
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onConfirm,
  confirmText = '确认',
  confirmLoading = false,
  confirmDisabled = false,
  confirmVariant = 'primary',
  cancelText = '取消',
}: ModalProps) {
  const hasDefaultFooter = onConfirm !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <DialogBody>{children}</DialogBody>

        {(footer || hasDefaultFooter) && (
          <DialogFooter>
            {footer ?? (
              <>
                <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={confirmLoading}>
                  {cancelText}
                </Button>
                <Button
                  variant={confirmVariant}
                  onClick={onConfirm}
                  disabled={confirmDisabled}
                  icon={confirmLoading ? <Loader2 className="spin" size={15} /> : undefined}
                >
                  {confirmLoading ? `${confirmText}中...` : confirmText}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
