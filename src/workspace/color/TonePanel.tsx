import { RotateCcw } from 'lucide-react'

import { TONE_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'
import { exposureValue } from './colorPanelShared'

interface TonePanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function TonePanel({ value, modified, onChange }: TonePanelProps) {
  return (
    <Accordion
      title="影调"
      defaultOpen
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(TONE_DEFAULTS)} title="重置影调">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ParamSlider label="曝光" value={value.exposure} {...sliderRange(EDIT_PARAMETER_RANGES.color.exposure)} onChange={(exposure) => onChange({ exposure })} formatValue={exposureValue} />
      <ParamSlider label="黑场" value={value.black} {...sliderRange(EDIT_PARAMETER_RANGES.color.black)} onChange={(black) => onChange({ black })} />
      <ParamSlider label="对比度" value={value.contrast} {...sliderRange(EDIT_PARAMETER_RANGES.color.contrast)} onChange={(contrast) => onChange({ contrast })} />
      <ParamSlider label="鲜艳度" value={value.vibrance} {...sliderRange(EDIT_PARAMETER_RANGES.color.vibrance)} onChange={(vibrance) => onChange({ vibrance })} />
      <ParamSlider label="饱和度" value={value.saturation} {...sliderRange(EDIT_PARAMETER_RANGES.color.saturation)} onChange={(saturation) => onChange({ saturation })} />
      <ParamSlider label="高光" value={value.highlights} {...sliderRange(EDIT_PARAMETER_RANGES.color.highlights)} onChange={(highlights) => onChange({ highlights })} />
      <ParamSlider label="阴影" value={value.shadows} {...sliderRange(EDIT_PARAMETER_RANGES.color.shadows)} onChange={(shadows) => onChange({ shadows })} />
      <ParamSlider label="白色" value={value.whites} {...sliderRange(EDIT_PARAMETER_RANGES.color.whites)} onChange={(whites) => onChange({ whites })} />
      <ParamSlider label="黑色" value={value.blacks} {...sliderRange(EDIT_PARAMETER_RANGES.color.blacks)} onChange={(blacks) => onChange({ blacks })} />
    </Accordion>
  )
}
