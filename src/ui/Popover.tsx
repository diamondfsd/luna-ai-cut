import * as RadixPopover from '@radix-ui/react-popover'

/* ==================== Root ==================== */
export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger

/* ==================== Content ==================== */
export function PopoverContent({
  children,
  className,
  align = 'end',
  sideOffset = 6,
  ...props
}: RadixPopover.PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        className={`ui-popover-content ${className ?? ''}`}
        align={align}
        sideOffset={sideOffset}
        {...props}
      >
        {children}
        <RadixPopover.Arrow className="ui-popover-arrow" />
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}

/* ==================== Close ==================== */
export const PopoverClose = RadixPopover.Close
