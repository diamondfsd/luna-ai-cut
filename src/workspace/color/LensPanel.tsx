import { RotateCcw } from 'lucide-react'

import { LENS_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
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
      <ParamSlider label="暗角调节" value={effects.lensVignetting} min={-100} max={100} onChange={(lensVignetting) => onEffectsChange({ lensVignetting })} />
      <ParamSlider label="创意暗角" value={effects.vignette} min={-100} max={100} onChange={(vignette) => onEffectsChange({ vignette })} />
      <ParamSlider label="色差" value={effects.chromaticAberration} min={0} max={100} onChange={(chromaticAberration) => onEffectsChange({ chromaticAberration })} formatValue={String} />
    </Accordion>
  )
}
