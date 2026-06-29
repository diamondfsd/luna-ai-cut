import type { EditPipeline } from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'
import { Button } from '../../ui'

interface EffectsPanelProps {
  value: EditPipeline['effects']
  onChange: (patch: Partial<EditPipeline['effects']>) => void
  onReset: () => void
}

export function EffectsPanel({ value, onChange, onReset }: EffectsPanelProps) {
  return (
    <div className="workspace-panel-stack">
      <ParamSlider label="锐化" value={value.sharpen} min={0} max={100} onChange={(sharpen) => onChange({ sharpen })} />
      <ParamSlider label="暗角" value={value.vignette} min={0} max={100} onChange={(vignette) => onChange({ vignette })} />
      <div className="workspace-panel-actions">
        <Button variant="ghost" size="mini" onClick={onReset}>重置效果</Button>
      </div>
    </div>
  )
}
