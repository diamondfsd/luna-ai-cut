import { RotateCcw } from 'lucide-react'

import { GRADING_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
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
          <ColorWheel size="mini" label="阴影颜色" hue={value.gradeShadowsHue} saturation={Math.abs(value.gradeShadowsAmount)} onChange={(gradeShadowsHue, gradeShadowsAmount) => onChange({ gradeShadowsHue, gradeShadowsAmount })} />
        </div>
        <div>
          <span>中间调</span>
          <ColorWheel size="mini" label="中间调颜色" hue={value.gradeMidHue} saturation={Math.abs(value.gradeMidAmount)} onChange={(gradeMidHue, gradeMidAmount) => onChange({ gradeMidHue, gradeMidAmount })} />
        </div>
        <div>
          <span>高光</span>
          <ColorWheel size="mini" label="高光颜色" hue={value.gradeHighlightsHue} saturation={Math.abs(value.gradeHighlightsAmount)} onChange={(gradeHighlightsHue, gradeHighlightsAmount) => onChange({ gradeHighlightsHue, gradeHighlightsAmount })} />
        </div>
      </div>
    </Accordion>
  )
}
