import { Pipette, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'

import { Accordion, Button, ButtonGroup, IconButton, Tooltip } from '../../ui'
import { toast } from '../../ui/toast'
import { ParamSlider } from '../components/ParamSlider'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { HSL_CHANNELS, HSL_DEFAULTS, type EditPipeline, type HslChannelAdjust, type HslChannelKey } from '../shared/editPipeline'
import { ColorBarSlider, hueColor } from './colorPanelShared'
import './HslPanel.css'

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
  onPreviewChange?: (patch: Partial<EditPipeline['color']>) => void
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360
}

function hexToHue(hex: string): number {
  const red = parseInt(hex.slice(1, 3), 16) / 255
  const green = parseInt(hex.slice(3, 5), 16) / 255
  const blue = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta === 0) return 0
  const sector = max === red
    ? ((green - blue) / delta) % 6
    : max === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4
  return normalizeHue(Math.round(sector * 60))
}

function hueToHex(hue: number): string {
  const normalized = normalizeHue(hue) / 60
  const chroma = 0.92
  const x = chroma * (1 - Math.abs(normalized % 2 - 1))
  const [red, green, blue] = normalized < 1 ? [chroma, x, 0]
    : normalized < 2 ? [x, chroma, 0]
      : normalized < 3 ? [0, chroma, x]
        : normalized < 4 ? [0, x, chroma]
          : normalized < 5 ? [x, 0, chroma]
            : [chroma, 0, x]
  const toHex = (value: number) => Math.round((value + 0.04) * 255).toString(16).padStart(2, '0')
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function channelGradient(hue: number, hueShift: number, mode: HslMode): string {
  const targetHue = normalizeHue(hue + hueShift)
  if (mode === 'hue') {
    const stops = Array.from({ length: 13 }, (_, index) => {
      const shift = -180 + index * 30
      return `${hueColor(normalizeHue(hue + shift), 92)} ${index / 12 * 100}%`
    })
    return `linear-gradient(90deg, ${stops.join(', ')})`
  }
  if (mode === 'saturation') {
    return `linear-gradient(90deg, hsl(${targetHue} 0% 56%), ${hueColor(targetHue, 100)})`
  }
  return `linear-gradient(90deg, #050505, ${hueColor(targetHue, 88)}, #ffffff)`
}

function channelValue(channel: HslChannelAdjust, mode: HslMode): number {
  if (mode === 'hue') return channel.hueShift
  if (mode === 'saturation') return channel.saturation
  return channel.luminance
}

function withModeValue(channel: HslChannelAdjust, mode: HslMode, next: number): HslChannelAdjust {
  if (mode === 'hue') return { ...channel, hueShift: next }
  if (mode === 'saturation') return { ...channel, saturation: next }
  return { ...channel, luminance: next }
}

export function HslPanel({ value, modified, onChange, onPreviewChange }: HslPanelProps) {
  const [mode, setMode] = useState<HslMode>('saturation')
  const previewChange = onPreviewChange ?? onChange
  const range = mode === 'hue'
    ? sliderRange(EDIT_PARAMETER_RANGES.hsl.hue)
    : sliderRange(EDIT_PARAMETER_RANGES.hsl.saturation)

  function updateDefaultChannel(channelKey: HslChannelKey, next: number, update = onChange): void {
    update({
      hslChannels: {
        ...value.hslChannels,
        [channelKey]: withModeValue(value.hslChannels[channelKey], mode, next),
      },
    })
  }

  function updateCustomChannel(index: number, next: number, update = onChange): void {
    update({
      customHslChannels: value.customHslChannels.map((channel, channelIndex) => (
        channelIndex === index ? withModeValue(channel, mode, next) : channel
      )),
    })
  }

  async function addCustomColor(): Promise<void> {
    if (value.customHslChannels.length >= 4) return
    const EyeDropper = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper
    if (typeof EyeDropper !== 'function') {
      toast.error('当前设备不支持画面取色')
      return
    }
    try {
      const result = await new EyeDropper().open()
      onChange({
        customHslChannels: [
          { hue: hexToHue(result.sRGBHex), hueShift: 0, saturation: 0, luminance: 0, sourceColor: result.sRGBHex.toUpperCase() },
          ...value.customHslChannels,
        ],
      })
    } catch {
      // 取消取色时保持当前设置。
    }
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
      <div className="workspace-hsl-toolbar">
        <ButtonGroup
          className="workspace-panel-tabs"
          options={HSL_MODES}
          value={mode}
          onChange={(next) => setMode(next as HslMode)}
        />
        <Button
          variant="ghost"
          size="mini"
          icon={<Pipette size={14} />}
          disabled={value.customHslChannels.length >= 4}
          onClick={() => void addCustomColor()}
        >
          新增颜色
        </Button>
      </div>

      <div className="workspace-hsl-channel-list">
        {value.customHslChannels.map((channel, index) => (
          <div className="workspace-hsl-custom-channel" key={`${channel.hue}-${index}`}>
            <ColorBarSlider color={channelGradient(channel.hue, channel.hueShift, mode)}>
              <ParamSlider
                label={(
                  <span className="workspace-hsl-custom-label">
                    <span className="workspace-hsl-custom-swatch" style={{ background: channel.sourceColor ?? hueColor(channel.hue, 92) }} />
                    <span>{(channel.sourceColor ?? hueToHex(channel.hue)).toUpperCase()}</span>
                    <Tooltip content="移除自定义颜色">
                      <IconButton
                        variant="ghost"
                        size="mini"
                        icon={<X size={13} />}
                        onClick={() => onChange({ customHslChannels: value.customHslChannels.filter((_, itemIndex) => itemIndex !== index) })}
                      />
                    </Tooltip>
                  </span>
                )}
                value={channelValue(channel, mode)}
                {...range}
                onChange={(next) => updateCustomChannel(index, next)}
                onPreviewChange={(next) => updateCustomChannel(index, next, previewChange)}
                onCommit={(next) => updateCustomChannel(index, next)}
                formatValue={(next) => String(Math.round(next))}
              />
            </ColorBarSlider>
          </div>
        ))}

        {HSL_CHANNELS.map((channel) => {
          const adjustment = value.hslChannels[channel.key]
          return (
            <ColorBarSlider key={channel.key} color={channelGradient(channel.hue, adjustment.hueShift, mode)}>
              <ParamSlider
                label={channel.label}
                value={channelValue(adjustment, mode)}
                {...range}
                onChange={(next) => updateDefaultChannel(channel.key, next)}
                onPreviewChange={(next) => updateDefaultChannel(channel.key, next, previewChange)}
                onCommit={(next) => updateDefaultChannel(channel.key, next)}
                formatValue={(next) => String(Math.round(next))}
              />
            </ColorBarSlider>
          )
        })}

      </div>
    </Accordion>
  )
}
