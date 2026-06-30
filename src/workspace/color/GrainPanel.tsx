import { RotateCcw } from 'lucide-react'

import { GRAIN_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'

interface GrainPanelProps {
  effects: EditPipeline['effects']
  modified: boolean
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
}

export function GrainPanel({ effects, modified, onEffectsChange }: GrainPanelProps) {
  return (
    <Accordion
      title="颗粒"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(GRAIN_DEFAULTS)} title="重置颗粒">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ParamSlider label="数量" value={effects.grainAmount} {...sliderRange(EDIT_PARAMETER_RANGES.effects.grainAmount)} onChange={(grainAmount) => onEffectsChange({ grainAmount })} formatValue={String} />
      <ParamSlider label="大小" value={effects.grainSize} {...sliderRange(EDIT_PARAMETER_RANGES.effects.grainSize)} onChange={(grainSize) => onEffectsChange({ grainSize })} formatValue={String} />
      <ParamSlider label="粗糙度" value={effects.grainRoughness} {...sliderRange(EDIT_PARAMETER_RANGES.effects.grainRoughness)} onChange={(grainRoughness) => onEffectsChange({ grainRoughness })} formatValue={String} />
    </Accordion>
  )
}
