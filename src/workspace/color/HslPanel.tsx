import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { HSL_CHANNELS, HSL_DEFAULTS, type EditPipeline, type HslChannelKey } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, ButtonGroup } from '../../ui'
import { ColorBarSlider } from './colorPanelShared'

type HslMode = 'hue' | 'saturation' | 'luminance'

const HSL_MODES: Array<{ value: HslMode; label: string }> = [
  { value: 'hue', label: '色相' },
  { value: 'saturation', label: '饱和度' },
  { value: 'luminance', label: '明亮度' },
]

interface HslPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

function channelValue(value: EditPipeline['color'], channelKey: HslChannelKey, mode: HslMode): number {
  const channel = value.hslChannels[channelKey]
  if (mode === 'hue') return channel.hueShift
  if (mode === 'saturation') return channel.saturation
  return channel.luminance
}

export function HslPanel({ value, modified, onChange }: HslPanelProps) {
  const [mode, setMode] = useState<HslMode>('saturation')
  const range = mode === 'hue'
    ? sliderRange(EDIT_PARAMETER_RANGES.hsl.hue)
    : sliderRange(EDIT_PARAMETER_RANGES.hsl.saturation)

  function updateChannel(channelKey: HslChannelKey, next: number): void {
    const current = value.hslChannels[channelKey]
    onChange({
      hslChannels: {
        ...value.hslChannels,
        [channelKey]: {
          ...current,
          ...(mode === 'hue'
            ? { hueShift: next }
            : mode === 'saturation'
              ? { saturation: next }
              : { luminance: next }),
        },
      },
    })
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
      <ButtonGroup
        className="workspace-panel-tabs"
        options={HSL_MODES}
        value={mode}
        onChange={(next) => setMode(next as HslMode)}
      />
      <div className="workspace-hsl-channel-list">
        {HSL_CHANNELS.map((channel) => (
          <ColorBarSlider key={channel.label} color={`linear-gradient(90deg, ${channel.color}, #ffffff, ${channel.color})`}>
            <ParamSlider
              label={channel.label}
              value={channelValue(value, channel.key, mode)}
              {...range}
              onChange={(next) => updateChannel(channel.key, next)}
              formatValue={(next) => String(Math.round(next))}
            />
          </ColorBarSlider>
        ))}
      </div>
    </Accordion>
  )
}
