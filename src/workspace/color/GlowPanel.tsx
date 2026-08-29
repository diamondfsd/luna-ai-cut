import { RotateCcw } from 'lucide-react'

import { Accordion } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { GLOW_DEFAULTS, type EditPipeline } from '../shared/editPipeline'

interface GlowPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onPreviewChange?: (patch: Partial<EditPipeline['color']>) => void
}

export function GlowPanel({ value, modified, onChange, onPreviewChange }: GlowPanelProps) {
  const previewChange = onPreviewChange ?? onChange
  return (
    <Accordion
      title="辉光"
      modified={modified}
      actions={(
        <button
          className="workspace-acc-reset"
          type="button"
          onClick={() => onChange(GLOW_DEFAULTS)}
          title="重置辉光"
          aria-label="重置辉光"
        >
          <RotateCcw size={11} />
        </button>
      )}
    >
      <ParamSlider label="强度" value={value.glowStrength} {...sliderRange(EDIT_PARAMETER_RANGES.color.glowStrength)} onChange={(glowStrength) => previewChange({ glowStrength })} onCommit={(glowStrength) => onChange({ glowStrength })} formatValue={String} />
      <ParamSlider label="范围" value={value.glowRadius} {...sliderRange(EDIT_PARAMETER_RANGES.color.glowRadius)} onChange={(glowRadius) => previewChange({ glowRadius })} onCommit={(glowRadius) => onChange({ glowRadius })} formatValue={String} />
      <ParamSlider label="高光阈值" value={value.glowThreshold} {...sliderRange(EDIT_PARAMETER_RANGES.color.glowThreshold)} onChange={(glowThreshold) => previewChange({ glowThreshold })} onCommit={(glowThreshold) => onChange({ glowThreshold })} formatValue={String} />
    </Accordion>
  )
}
