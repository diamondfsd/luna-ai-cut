import { RotateCcw } from 'lucide-react'

import { Button } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import type { CreativeSlotTransform } from '../shared/creativeMedia'

interface TripleStitchTransformPanelProps {
  activeSlot: number
  transform: CreativeSlotTransform
  onChange: (slot: number, patch: Partial<CreativeSlotTransform>) => void
  onReset: () => void
}

export function TripleStitchTransformPanel({
  activeSlot,
  transform,
  onChange,
  onReset,
}: TripleStitchTransformPanelProps) {
  return (
    <aside className="triple-stitch-panel triple-stitch-adjust-panel">
      <div className="triple-stitch-section-title">第 {activeSlot + 1} 段画面</div>
      <ParamSlider
        label="缩放"
        value={transform.scale}
        min={1}
        max={3}
        step={0.05}
        onChange={(value) => onChange(activeSlot, { scale: value })}
        formatValue={(value) => value.toFixed(2)}
      />
      <ParamSlider
        label="左右"
        value={Math.round(transform.offsetX)}
        min={-540}
        max={540}
        step={1}
        onChange={(value) => onChange(activeSlot, { offsetX: value })}
      />
      <ParamSlider
        label="上下"
        value={Math.round(transform.offsetY)}
        min={-320}
        max={320}
        step={1}
        onChange={(value) => onChange(activeSlot, { offsetY: value })}
      />
      <Button variant="secondary" size="compact" icon={<RotateCcw size={14} />} onClick={onReset}>
        重置画面
      </Button>
    </aside>
  )
}
