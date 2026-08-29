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
  onPreviewChange?: (patch: Partial<EditPipeline['color']>) => void
}

export function TonePanel({ value, modified, onChange, onPreviewChange }: TonePanelProps) {
  const previewChange = onPreviewChange ?? onChange
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
      <ParamSlider label="曝光" value={value.exposure} {...sliderRange(EDIT_PARAMETER_RANGES.color.exposure)} onChange={(exposure) => previewChange({ exposure })} onCommit={(exposure) => onChange({ exposure })} formatValue={exposureValue} />
      <ParamSlider label="对比度" value={value.contrast} {...sliderRange(EDIT_PARAMETER_RANGES.color.contrast)} onChange={(contrast) => previewChange({ contrast })} onCommit={(contrast) => onChange({ contrast })} />
      <ParamSlider label="亮度" value={value.brightness} {...sliderRange(EDIT_PARAMETER_RANGES.color.brightness)} onChange={(brightness) => previewChange({ brightness })} onCommit={(brightness) => onChange({ brightness })} />
      <ParamSlider label="高光" value={value.highlights} {...sliderRange(EDIT_PARAMETER_RANGES.color.highlights)} onChange={(highlights) => previewChange({ highlights })} onCommit={(highlights) => onChange({ highlights })} />
      <ParamSlider label="阴影" value={value.shadows} {...sliderRange(EDIT_PARAMETER_RANGES.color.shadows)} onChange={(shadows) => previewChange({ shadows })} onCommit={(shadows) => onChange({ shadows })} />
      <ParamSlider label="白色" value={value.whites} {...sliderRange(EDIT_PARAMETER_RANGES.color.whites)} onChange={(whites) => previewChange({ whites })} onCommit={(whites) => onChange({ whites })} />
      <ParamSlider label="黑色" value={value.blacks} {...sliderRange(EDIT_PARAMETER_RANGES.color.blacks)} onChange={(blacks) => previewChange({ blacks })} onCommit={(blacks) => onChange({ blacks })} />
      <ParamSlider label="清晰度" value={value.clarity} {...sliderRange(EDIT_PARAMETER_RANGES.color.clarity)} onChange={(clarity) => previewChange({ clarity })} onCommit={(clarity) => onChange({ clarity })} />
      <ParamSlider label="纹理" value={value.texture} {...sliderRange(EDIT_PARAMETER_RANGES.color.texture)} onChange={(texture) => previewChange({ texture })} onCommit={(texture) => onChange({ texture })} />
      <ParamSlider label="鲜艳度" value={value.vibrance} {...sliderRange(EDIT_PARAMETER_RANGES.color.vibrance)} onChange={(vibrance) => previewChange({ vibrance })} onCommit={(vibrance) => onChange({ vibrance })} />
      <ParamSlider label="饱和度" value={value.saturation} {...sliderRange(EDIT_PARAMETER_RANGES.color.saturation)} onChange={(saturation) => previewChange({ saturation })} onCommit={(saturation) => onChange({ saturation })} />
    </Accordion>
  )
}
