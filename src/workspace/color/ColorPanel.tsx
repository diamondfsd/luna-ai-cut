import { HSL_CHANNELS, type EditPipeline } from '../shared/editPipeline'
import { CurvePanel } from './CurvePanel'
import { DetailPanel } from './DetailPanel'
import { GradingPanel } from './GradingPanel'
import { HslPanel } from './HslPanel'
import { TonePanel } from './TonePanel'
import { WhiteBalancePanel } from './WhiteBalancePanel'
import { ColorPresetPanel } from './ColorPresetPanel'

interface ColorPanelProps {
  value: EditPipeline['color']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onActivatePipette?: () => void
}

export function ColorPanel({ value, onChange, onActivatePipette }: ColorPanelProps) {
  const activeCurve = value.curve.points[value.curve.activeChannel]

  const modified = {
    whiteBalance: value.temperature !== 0 || value.tint !== 0 || value.whiteBalanceMode !== 'custom',
    tone: value.exposure !== 0 || value.contrast !== 0 || value.brightness !== 0 ||
      value.highlights !== 0 || value.shadows !== 0 || value.whites !== 0 || value.blacks !== 0 ||
      value.clarity !== 0 || value.texture !== 0 ||
      value.vibrance !== 0 || value.saturation !== 0,
    curve: activeCurve.length > 0 ||
      value.levelsBlack !== 0 || value.levelsWhite !== 1,
    hsl: value.customHslChannels.length > 0 || HSL_CHANNELS.some((channel) => {
      const current = value.hslChannels[channel.key]
      return current.hueShift !== 0 || current.saturation !== 0 || current.luminance !== 0
    }),
    grading: value.gradeShadowsAmount !== 0 || value.gradeMidAmount !== 0 || value.gradeHighlightsAmount !== 0,
    detail: value.sharpen !== 0 || value.denoise !== 0,
  }

  const handlePresetApply = (color: EditPipeline['color']) => {
    onChange(color)
  }

  return (
    <div className="workspace-color-modules">
      <ColorPresetPanel value={value} onApply={handlePresetApply} />
      <WhiteBalancePanel value={value} modified={modified.whiteBalance} onChange={onChange} onActivatePipette={onActivatePipette} />
      <TonePanel value={value} modified={modified.tone} onChange={onChange} />
      <CurvePanel value={value} modified={modified.curve} onChange={onChange} />
      <HslPanel value={value} modified={modified.hsl} onChange={onChange} />
      <GradingPanel value={value} modified={modified.grading} onChange={onChange} />
      <DetailPanel value={value} modified={modified.detail} onChange={onChange} />
    </div>
  )
}
