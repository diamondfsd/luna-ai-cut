import { RotateCcw } from 'lucide-react'

import { DETAIL_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'
import { decimalValue } from './colorPanelShared'

interface DetailPanelProps {
  effects: EditPipeline['effects']
  modified: boolean
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
}

export function DetailPanel({ effects, modified, onEffectsChange }: DetailPanelProps) {
  return (
    <Accordion
      title="细节"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onEffectsChange(DETAIL_DEFAULTS)} title="重置细节">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ParamSlider label="锐化" value={effects.sharpen} {...sliderRange(EDIT_PARAMETER_RANGES.effects.sharpen)} onChange={(sharpen) => onEffectsChange({ sharpen })} formatValue={String} />
      <ParamSlider label="半径" value={effects.sharpenRadius} {...sliderRange(EDIT_PARAMETER_RANGES.effects.sharpenRadius)} onChange={(sharpenRadius) => onEffectsChange({ sharpenRadius })} formatValue={decimalValue} />
      <ParamSlider label="细节" value={effects.sharpenDetail} {...sliderRange(EDIT_PARAMETER_RANGES.effects.sharpenDetail)} onChange={(sharpenDetail) => onEffectsChange({ sharpenDetail })} formatValue={String} />
      <ParamSlider label="蒙版" value={effects.sharpenMasking} {...sliderRange(EDIT_PARAMETER_RANGES.effects.sharpenMasking)} onChange={(sharpenMasking) => onEffectsChange({ sharpenMasking })} formatValue={String} />
      <ParamSlider label="噪点消除" value={effects.noiseReduction} {...sliderRange(EDIT_PARAMETER_RANGES.effects.noiseReduction)} onChange={(noiseReduction) => onEffectsChange({ noiseReduction })} formatValue={String} />
      <ParamSlider label="减少杂色" value={effects.colorNoiseReduction} {...sliderRange(EDIT_PARAMETER_RANGES.effects.colorNoiseReduction)} onChange={(colorNoiseReduction) => onEffectsChange({ colorNoiseReduction })} formatValue={String} />
    </Accordion>
  )
}
