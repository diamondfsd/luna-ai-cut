import { DropdownMenu as RadixDropdownMenu } from 'radix-ui'
import { cx } from './utils'
import './dropdown-menu.css'

export const DropdownMenu = RadixDropdownMenu.Root
export const DropdownMenuTrigger = RadixDropdownMenu.Trigger

export function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...props }: RadixDropdownMenu.DropdownMenuContentProps) {
  return <RadixDropdownMenu.Portal>
    <RadixDropdownMenu.Content className={cx('ui-dropdown-menu-content', className)} align={align} sideOffset={sideOffset} {...props} />
  </RadixDropdownMenu.Portal>
}

export function DropdownMenuItem({ className, destructive = false, ...props }: RadixDropdownMenu.DropdownMenuItemProps & { destructive?: boolean }) {
  return <RadixDropdownMenu.Item className={cx('ui-dropdown-menu-item', className)} data-destructive={destructive || undefined} {...props} />
}
