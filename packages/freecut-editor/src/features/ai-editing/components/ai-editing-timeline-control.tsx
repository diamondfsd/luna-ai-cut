import { memo, useState } from 'react'
import { WandSparkles } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { EDITOR_LAYOUT_CSS_VALUES } from '@freecut/config/editor-layout'
import { AiEditingDialog } from './ai-editing-dialog'

export const AiEditingTimelineControl = memo(function AiEditingTimelineControl() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        style={{
          width: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
          height: EDITOR_LAYOUT_CSS_VALUES.toolbarButtonSize,
        }}
        className="editor-toolbar-button timeline-header-button"
        onClick={() => setOpen(true)}
        aria-label="打开剪辑助手"
        data-tooltip="剪辑助手"
      >
        <WandSparkles className="h-3.5 w-3.5" />
      </Button>
      <AiEditingDialog open={open} onOpenChange={setOpen} />
    </>
  )
})
