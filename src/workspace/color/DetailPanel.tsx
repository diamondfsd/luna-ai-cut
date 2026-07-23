import { RotateCcw } from 'lucide-react'

import { DETAIL_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'

interface DetailPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function DetailPanel({ value, modified, onChange }: DetailPanelProps) {
  return (
    <Accordion
      title="细节"
      modified={modified}
      actions={
        <button
          className="workspace-acc-reset"
          type="button"
          onClick={() => onChange(DETAIL_DEFAULTS)}
          title="重置细节"
        >
          <RotateCcw size={11} />
        </button>
      }
    >
      <ParamSlider label="锐化" value={value.sharpen} {...sliderRange(EDIT_PARAMETER_RANGES.color.sharpen)} onChange={(sharpen) => onChange({ sharpen })} formatValue={String} />
      <ParamSlider label="降噪" value={value.denoise} {...sliderRange(EDIT_PARAMETER_RANGES.color.denoise)} onChange={(denoise) => onChange({ denoise })} formatValue={String} />
    </Accordion>
  )
}
