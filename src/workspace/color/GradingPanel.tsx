import { RotateCcw } from 'lucide-react'

import { GRADING_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'
import { ColorWheel } from './colorPanelShared'

interface GradingPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function GradingPanel({ value, modified, onChange }: GradingPanelProps) {
  return (
    <Accordion
      title="颜色分级"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(GRADING_DEFAULTS)} title="重置颜色分级">
          <RotateCcw size={11} />
        </button>
      }
    >
      <div className="workspace-grading-wheels">
        <div>
          <span>阴影</span>
          <ColorWheel size="mini" label="阴影颜色" hue={value.grading.shadowsHue} saturation={value.grading.shadowsSaturation} onChange={(shadowsHue, shadowsSaturation) => onChange({ grading: { ...value.grading, shadowsHue, shadowsSaturation } })} />
        </div>
        <div>
          <span>中间调</span>
          <ColorWheel size="mini" label="中间调颜色" hue={value.grading.midtonesHue} saturation={value.grading.midtonesSaturation} onChange={(midtonesHue, midtonesSaturation) => onChange({ grading: { ...value.grading, midtonesHue, midtonesSaturation } })} />
        </div>
        <div>
          <span>高光</span>
          <ColorWheel size="mini" label="高光颜色" hue={value.grading.highlightsHue} saturation={value.grading.highlightsSaturation} onChange={(highlightsHue, highlightsSaturation) => onChange({ grading: { ...value.grading, highlightsHue, highlightsSaturation } })} />
        </div>
      </div>
      <ParamSlider label="混合" value={value.grading.blending} {...sliderRange(EDIT_PARAMETER_RANGES.grading.blending)} onChange={(blending) => onChange({ grading: { ...value.grading, blending } })} formatValue={String} />
      <ParamSlider label="平衡" value={value.grading.balance} {...sliderRange(EDIT_PARAMETER_RANGES.grading.balance)} onChange={(balance) => onChange({ grading: { ...value.grading, balance } })} />
    </Accordion>
  )
}
