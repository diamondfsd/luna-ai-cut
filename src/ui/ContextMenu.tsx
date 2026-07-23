import { ContextMenu as RadixContextMenu } from 'radix-ui'

import { cx } from './utils'
import './context-menu.css'

export const ContextMenu = RadixContextMenu.Root
export const ContextMenuTrigger = RadixContextMenu.Trigger

export function ContextMenuContent({ className, ...props }: RadixContextMenu.ContextMenuContentProps) {
  return (
    <RadixContextMenu.Portal>
      <RadixContextMenu.Content
        className={cx('ui-context-menu-content', className)}
        {...props}
      />
    </RadixContextMenu.Portal>
  )
}

export function ContextMenuItem({ className, ...props }: RadixContextMenu.ContextMenuItemProps) {
  return <RadixContextMenu.Item className={cx('ui-context-menu-item', className)} {...props} />
}
