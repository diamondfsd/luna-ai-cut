import { RotateCcw } from 'lucide-react'

import { HSL_DEFAULTS, type ColorMixChannel, type EditPipeline, type HslAdjust } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, PillTabs } from '../../ui'
import { ColorBarSlider, HSL_CHANNELS } from './colorPanelShared'

interface HslPanelProps {
  value: EditPipeline['color']
  mode: 'hue' | 'saturation' | 'luminance'
  modified: boolean
  onModeChange: (mode: 'hue' | 'saturation' | 'luminance') => void
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function HslPanel({ value, mode, modified, onModeChange, onChange }: HslPanelProps) {
  function updateHsl(channel: ColorMixChannel, patch: Partial<HslAdjust>): void {
    onChange({ hsl: { ...value.hsl, [channel]: { ...value.hsl[channel], ...patch } } })
  }

  return (
    <Accordion
      title="HSL"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(HSL_DEFAULTS)} title="重置HSL">
          <RotateCcw size={11} />
        </button>
      }
    >
      <PillTabs
        value={mode}
        onValueChange={(next) => onModeChange(next as typeof mode)}
        items={[
          { value: 'hue', label: '色相' },
          { value: 'saturation', label: '饱和度' },
          { value: 'luminance', label: '明亮度' },
        ]}
        className="workspace-panel-tabs"
      />
      {HSL_CHANNELS.map(({ key, label, color }) => (
        <ColorBarSlider key={key} color={`linear-gradient(90deg, ${color}, #ffffff, ${color})`}>
          <ParamSlider
            label={label}
            value={value.hsl[key][mode]}
            {...sliderRange(EDIT_PARAMETER_RANGES.hsl[mode])}
            onChange={(next) => updateHsl(key, { [mode]: next })}
          />
        </ColorBarSlider>
      ))}
    </Accordion>
  )
}
