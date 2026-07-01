import { RotateCcw } from 'lucide-react'

import { HSL_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, ButtonGroup } from '../../ui'
import { ColorBarSlider, HSL_CHANNELS } from './colorPanelShared'

interface HslPanelProps {
  value: EditPipeline['color']
  mode: 'hue' | 'saturation' | 'luminance'
  modified: boolean
  onModeChange: (mode: 'hue' | 'saturation' | 'luminance') => void
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function HslPanel({ value, mode, modified, onModeChange, onChange }: HslPanelProps) {
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
      <ButtonGroup
        value={mode}
        onChange={onModeChange}
        options={[
          { value: 'hue', label: '色相' },
          { value: 'saturation', label: '饱和度' },
          { value: 'luminance', label: '明亮度' },
        ]}
        className="workspace-panel-tabs"
      />
      {HSL_CHANNELS.map(({ key, label, hue, color }) => {
        const isActive = Math.abs(value.hslHue - hue) < 18 || Math.abs(value.hslHue - hue) > 342
        const displayValue = isActive
          ? (mode === 'hue' ? value.hue : mode === 'saturation' ? value.hslSat : value.hslLum)
          : 0
        return (
          <ColorBarSlider key={key} color={`linear-gradient(90deg, ${color}, #ffffff, ${color})`}>
            <ParamSlider
              label={label}
              value={displayValue}
              {...sliderRange(mode === 'hue' ? EDIT_PARAMETER_RANGES.hsl.hue : mode === 'saturation' ? EDIT_PARAMETER_RANGES.hsl.saturation : EDIT_PARAMETER_RANGES.hsl.luminance)}
              onChange={(next) => {
                onChange({
                  hslHue: hue,
                  ...(mode === 'hue' ? { hue: next } : mode === 'saturation' ? { hslSat: next } : { hslLum: next }),
                })
              }}
            />
          </ColorBarSlider>
        )
      })}
    </Accordion>
  )
}
