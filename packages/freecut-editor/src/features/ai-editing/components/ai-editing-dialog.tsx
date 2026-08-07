import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@freecut/components/ui/dialog'
import { AiEditingPanel } from './ai-editing-panel'

interface AiEditingDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

export function AiEditingDialog({ open, onOpenChange }: AiEditingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        className="h-[min(680px,calc(100dvh-2rem))] max-w-[min(680px,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>剪辑助手</DialogTitle>
        </DialogHeader>
        <AiEditingPanel
          closeButton={(
            <DialogPrimitive.Close asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="关闭剪辑助手"
                data-tooltip="关闭剪辑助手"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </DialogPrimitive.Close>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
