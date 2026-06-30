import { RotateCcw } from 'lucide-react'

import { LENS_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'

interface LensPanelProps {
  effects: EditPipeline['effects']
  modified: boolean
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
}

export function LensPanel({ effects, modified, onEffectsChange }: LensPanelProps) {
  return (
    <Accordion
      title="镜头调整"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(LENS_DEFAULTS)} title="重置镜头">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ParamSlider label="镜头暗角校正" value={effects.lensVignetting} {...sliderRange(EDIT_PARAMETER_RANGES.effects.lensVignetting)} onChange={(lensVignetting) => onEffectsChange({ lensVignetting })} />
      <ParamSlider label="创意暗角" value={effects.vignette} {...sliderRange(EDIT_PARAMETER_RANGES.effects.vignette)} onChange={(vignette) => onEffectsChange({ vignette })} />
      <ParamSlider label="色差" value={effects.chromaticAberration} {...sliderRange(EDIT_PARAMETER_RANGES.effects.chromaticAberration)} onChange={(chromaticAberration) => onEffectsChange({ chromaticAberration })} formatValue={String} />
    </Accordion>
  )
}
