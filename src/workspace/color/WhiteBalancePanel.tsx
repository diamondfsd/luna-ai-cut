import { Pipette, RotateCcw } from 'lucide-react'

import { WHITE_BALANCE_DEFAULTS, type EditPipeline, type WhiteBalanceMode } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, IconButton, Select, Tooltip } from '../../ui'
import { ColorBarSlider } from './colorPanelShared'

interface WhiteBalancePanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onActivatePipette?: () => void
}

const WHITE_BALANCE_OPTIONS: Array<{ value: WhiteBalanceMode; label: string; temperature: number; tint: number }> = [
  { value: 'custom', label: '自定义', temperature: 0, tint: 0 },
  { value: 'daylight', label: '日光', temperature: 0, tint: 2 },
  { value: 'cloudy', label: '阴天', temperature: 18, tint: 4 },
  { value: 'indoor', label: '室内', temperature: -42, tint: -3 },
]

export function WhiteBalancePanel({ value, modified, onChange, onActivatePipette }: WhiteBalancePanelProps) {
  function updateWhiteBalanceMode(whiteBalanceMode: string): void {
    const preset = WHITE_BALANCE_OPTIONS.find((item) => item.value === whiteBalanceMode)
    if (!preset) return
    onChange({
      whiteBalanceMode: preset.value,
      temperature: preset.temperature,
      tint: preset.tint,
    })
  }

  return (
    <Accordion
      title="白平衡"
      defaultOpen
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(WHITE_BALANCE_DEFAULTS)} title="重置白平衡">
          <RotateCcw size={11} />
        </button>
      }
    >
      <div className="workspace-inline-control">
        <Select
          variant="compact"
          fullWidth
          options={WHITE_BALANCE_OPTIONS.map(({ value: optionValue, label }) => ({ value: optionValue, label }))}
          value={value.whiteBalanceMode}
          onValueChange={updateWhiteBalanceMode}
        />
        <Tooltip content="吸取白点">
          <IconButton variant="ghost" size="compact" icon={<Pipette size={16} />} onClick={onActivatePipette} />
        </Tooltip>
      </div>
      <ColorBarSlider color="linear-gradient(90deg, #3958ff, #d9d3a5, #f5a35a)">
        <ParamSlider label="色温" value={value.temperature} {...sliderRange(EDIT_PARAMETER_RANGES.color.temperature)} onChange={(temperature) => onChange({ temperature, whiteBalanceMode: 'custom' })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #35bd4b, #b6b6b6, #d936c7)">
        <ParamSlider label="色调" value={value.tint} {...sliderRange(EDIT_PARAMETER_RANGES.color.tint)} onChange={(tint) => onChange({ tint, whiteBalanceMode: 'custom' })} />
      </ColorBarSlider>
    </Accordion>
  )
}
