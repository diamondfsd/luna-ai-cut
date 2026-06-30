import { RotateCcw } from 'lucide-react'

import {
  SELECTIVE_COLOR_DEFAULTS,
  type EditPipeline,
  type SelectiveColorAdjust,
  type SelectiveColorChannel,
  type SelectiveColorMode,
} from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, ButtonGroup } from '../../ui'
import { ColorBarSlider, SELECTIVE_CHANNELS } from './colorPanelShared'

interface SelectiveColorPanelProps {
  value: EditPipeline['color']
  channel: SelectiveColorChannel
  modified: boolean
  onChannelChange: (channel: SelectiveColorChannel) => void
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function SelectiveColorPanel({ value, channel, modified, onChannelChange, onChange }: SelectiveColorPanelProps) {
  const selective = value.selectiveColor[channel]

  function updateSelective(nextChannel: SelectiveColorChannel, patch: Partial<SelectiveColorAdjust>): void {
    onChange({ selectiveColor: { ...value.selectiveColor, [nextChannel]: { ...value.selectiveColor[nextChannel], ...patch } } })
  }

  return (
    <Accordion
      title="可选颜色"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(SELECTIVE_COLOR_DEFAULTS)} title="重置可选颜色">
          <RotateCcw size={11} />
        </button>
      }
    >
      <div className="workspace-color-swatches">
        {SELECTIVE_CHANNELS.map(({ key, label, color }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            className={channel === key ? 'active' : ''}
            style={{ background: color }}
            onClick={() => onChannelChange(key)}
          />
        ))}
      </div>
      <ColorBarSlider color="linear-gradient(90deg, #ff375f, #7ee7ef)">
        <ParamSlider label="青色" value={value.selectiveColor[channel].cyan} {...sliderRange(EDIT_PARAMETER_RANGES.selectiveColor.cyan)} onChange={(cyan) => updateSelective(channel, { cyan })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #30d158, #ff2d9a)">
        <ParamSlider label="洋红" value={value.selectiveColor[channel].magenta} {...sliderRange(EDIT_PARAMETER_RANGES.selectiveColor.magenta)} onChange={(magenta) => updateSelective(channel, { magenta })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #4057ff, #ffd60a)">
        <ParamSlider label="黄色" value={value.selectiveColor[channel].yellow} {...sliderRange(EDIT_PARAMETER_RANGES.selectiveColor.yellow)} onChange={(yellow) => updateSelective(channel, { yellow })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #ffffff, #000000)">
        <ParamSlider label="黑色" value={selective.black} {...sliderRange(EDIT_PARAMETER_RANGES.selectiveColor.black)} onChange={(black) => updateSelective(channel, { black })} />
      </ColorBarSlider>
      <ButtonGroup
        options={[
          { value: 'relative', label: '相对' },
          { value: 'absolute', label: '绝对' },
        ]}
        value={value.selectiveColorMode}
        onChange={(selectiveColorMode) => onChange({ selectiveColorMode: selectiveColorMode as SelectiveColorMode })}
      />
    </Accordion>
  )
}
