import { HSL_CHANNELS, type EditPipeline } from '../shared/editPipeline'
import { CurvePanel } from './CurvePanel'
import { DetailPanel } from './DetailPanel'
import { GradingPanel } from './GradingPanel'
import { GlowPanel } from './GlowPanel'
import { HslPanel } from './HslPanel'
import { TonePanel } from './TonePanel'
import { WhiteBalancePanel } from './WhiteBalancePanel'
import { ColorPresetPanel } from './ColorPresetPanel'

interface ColorPanelProps {
  value: EditPipeline['color']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onPreviewChange?: (patch: Partial<EditPipeline['color']>) => void
  onActivatePipette?: () => void
}

export function ColorPanel({ value, onChange, onPreviewChange, onActivatePipette }: ColorPanelProps) {
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
    glow: value.glowStrength !== 0,
  }

  const handlePresetApply = (color: EditPipeline['color']) => {
    onChange(color)
  }

  return (
    <div className="workspace-color-modules">
      <ColorPresetPanel value={value} onApply={handlePresetApply} />
      <WhiteBalancePanel value={value} modified={modified.whiteBalance} onChange={onChange} onPreviewChange={onPreviewChange} onActivatePipette={onActivatePipette} />
      <TonePanel value={value} modified={modified.tone} onChange={onChange} onPreviewChange={onPreviewChange} />
      <CurvePanel value={value} modified={modified.curve} onChange={onChange} onPreviewChange={onPreviewChange} />
      <HslPanel value={value} modified={modified.hsl} onChange={onChange} onPreviewChange={onPreviewChange} />
      <GradingPanel value={value} modified={modified.grading} onChange={onChange} onPreviewChange={onPreviewChange} />
      <DetailPanel value={value} modified={modified.detail} onChange={onChange} onPreviewChange={onPreviewChange} />
      <GlowPanel value={value} modified={modified.glow} onChange={onChange} onPreviewChange={onPreviewChange} />
    </div>
  )
}
