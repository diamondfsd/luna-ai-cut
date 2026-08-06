import { Crop, Loader2, SlidersHorizontal } from 'lucide-react'

import { Button } from '../../ui'
import './SmartOptimizePanel.css'

interface SmartOptimizePanelProps {
  mediaKind: 'image' | 'video' | null
  compositionLoading: boolean
  colorLoading: boolean
  onComposition: () => void
  onColor: () => void
}

export function SmartOptimizePanel({
  mediaKind,
  compositionLoading,
  colorLoading,
  onComposition,
  onColor,
}: SmartOptimizePanelProps) {
  const busy = compositionLoading || colorLoading
  return (
    <div className="workspace-smart-actions" aria-label="AI 工具">
      {mediaKind === 'image' && (
        <Button
          variant="primary"
          icon={compositionLoading ? <Loader2 className="spin" size={18} /> : <Crop size={18} />}
          disabled={busy}
          onClick={onComposition}
        >
          {compositionLoading ? '正在构图' : 'AI 构图'}
        </Button>
      )}
      <Button
        variant="primary"
        icon={colorLoading ? <Loader2 className="spin" size={18} /> : <SlidersHorizontal size={18} />}
        disabled={!mediaKind || busy}
        onClick={onColor}
      >
        {colorLoading ? '正在调色' : 'AI 调色'}
      </Button>
    </div>
  )
}
