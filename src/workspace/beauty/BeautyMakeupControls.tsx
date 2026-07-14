import { Button } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import type { BeautyMakeupSettings } from '../shared/beautySettings'

const LIPSTICK_COLORS = ['#a93f55', '#b94b5f', '#c76568', '#9f4f59']
const BLUSH_COLORS = ['#d8797d', '#e2928a', '#c96f75', '#d98b9a']

interface Props { value: BeautyMakeupSettings; onChange: (patch: Partial<BeautyMakeupSettings>) => void }

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string; onChange: (color: string) => void; label: string }) {
  return <div className="workspace-beauty-swatches" aria-label={label}>
    {colors.map((color) => <Button
      key={color}
      variant="ghost"
      size="mini"
      className="workspace-beauty-swatch"
      aria-label={`${label}${color}`}
      aria-pressed={value.toLowerCase() === color}
      onClick={() => onChange(color)}
    ><span style={{ backgroundColor: color }} /></Button>)}
  </div>
}

export function BeautyMakeupControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="口红" value={value.lipstick} min={0} max={100} onChange={(lipstick) => onChange({ lipstick })} />
    <Swatches label="口红颜色" colors={LIPSTICK_COLORS} value={value.lipstickColor} onChange={(lipstickColor) => onChange({ lipstickColor })} />
    <ParamSlider label="腮红" value={value.blush} min={0} max={100} onChange={(blush) => onChange({ blush })} />
    <Swatches label="腮红颜色" colors={BLUSH_COLORS} value={value.blushColor} onChange={(blushColor) => onChange({ blushColor })} />
  </div>
}
