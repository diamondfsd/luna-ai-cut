import type { EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'

interface EffectsPanelProps {
  value: EditPipeline['effects']
  onChange: (patch: Partial<EditPipeline['effects']>) => void
}

export function EffectsPanel({ value, onChange }: EffectsPanelProps) {
  return (
    <div className="workspace-panel-stack">
      <ParamSlider label="锐化" value={value.sharpen} {...sliderRange(EDIT_PARAMETER_RANGES.effects.sharpen)} onChange={(sharpen) => onChange({ sharpen })} />
      <ParamSlider label="降噪" value={value.denoise} {...sliderRange(EDIT_PARAMETER_RANGES.effects.denoise)} onChange={(denoise) => onChange({ denoise })} />
    </div>
  )
}
