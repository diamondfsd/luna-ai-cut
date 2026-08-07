import { memo } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'

interface AiEditingTimelineControlProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const AiEditingTimelineControl = memo(function AiEditingTimelineControl({
  open = false,
  onOpenChange,
}: AiEditingTimelineControlProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative h-7 w-8 shrink-0 border border-primary/40 bg-primary/10 p-0 text-primary hover:border-primary/70 hover:bg-primary/20 hover:text-primary"
      onClick={() => onOpenChange?.(!open)}
      aria-label={open ? '关闭剪辑助手' : '打开剪辑助手'}
      aria-pressed={open}
      data-tooltip="剪辑助手"
    >
      <span className="pt-1 text-[10px] font-semibold leading-none" aria-hidden="true">AI</span>
      <Sparkles className="absolute right-0.5 top-0.5 h-2.5 w-2.5" aria-hidden="true" />
    </Button>
  )
})
