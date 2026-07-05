import { RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { HSL_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
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

const HSL_CHANNELS = [
  { label: '红色', hue: 0, color: '#ff453a' },
  { label: '橙色', hue: 30, color: '#ff9f0a' },
  { label: '黄色', hue: 60, color: '#ffd60a' },
  { label: '绿色', hue: 120, color: '#30d158' },
  { label: '青色', hue: 180, color: '#64d2ff' },
  { label: '蓝色', hue: 240, color: '#0a84ff' },
  { label: '紫色', hue: 285, color: '#bf5af2' },
  { label: '洋红', hue: 320, color: '#ff2d9a' },
]

interface HslPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

function channelValue(value: EditPipeline['color'], channelHue: number, mode: HslMode): number {
  const distance = Math.abs(value.hslHue - channelHue)
  const circularDistance = Math.min(distance, 360 - distance)
  if (circularDistance >= 18) return 0
  if (mode === 'hue') return value.hue
  if (mode === 'saturation') return value.hslSat
  return value.hslLum
}

export function HslPanel({ value, modified, onChange }: HslPanelProps) {
  const [mode, setMode] = useState<HslMode>('saturation')
  const range = mode === 'hue'
    ? sliderRange(EDIT_PARAMETER_RANGES.hsl.hue)
    : sliderRange(EDIT_PARAMETER_RANGES.hsl.saturation)

  function updateChannel(channelHue: number, next: number): void {
    onChange({
      hslHue: channelHue,
      ...(mode === 'hue'
        ? { hue: next }
        : mode === 'saturation'
          ? { hslSat: next }
          : { hslLum: next }),
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
              value={channelValue(value, channel.hue, mode)}
              {...range}
              onChange={(next) => updateChannel(channel.hue, next)}
              formatValue={(next) => String(Math.round(next))}
            />
          </ColorBarSlider>
        ))}
      </div>
    </Accordion>
  )
}
