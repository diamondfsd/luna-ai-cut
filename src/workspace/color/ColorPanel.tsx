import { useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import { CurvePanel } from './CurvePanel'
import { DetailPanel } from './DetailPanel'
import { GradingPanel } from './GradingPanel'
import { HslPanel } from './HslPanel'
import { TonePanel } from './TonePanel'
import { WhiteBalancePanel } from './WhiteBalancePanel'

interface ColorPanelProps {
  value: EditPipeline['color']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onActivatePipette?: () => void
}

export function ColorPanel({ value, onChange, onActivatePipette }: ColorPanelProps) {
  const [hslMode, setHslMode] = useState<'hue' | 'saturation' | 'luminance'>('saturation')
  const activeCurve = value.curve.points[value.curve.activeChannel]

  const modified = {
    whiteBalance: value.temperature !== 0 || value.tint !== 0 || value.whiteBalanceMode !== 'custom',
    tone: value.exposure !== 0 || value.black !== 0 || value.contrast !== 0 ||
      value.highlights !== 0 || value.shadows !== 0 || value.whites !== 0 || value.blacks !== 0 ||
      value.vibrance !== 0 || value.saturation !== 0,
    curve: activeCurve.length > 0 || value.curveLift !== 0 || value.curveContrast !== 0 ||
      value.levelsBlack !== 0 || value.levelsGray !== 0.5 || value.levelsWhite !== 1,
    hsl: value.hslSat !== 0 || value.hslLum !== 0,
    grading: value.gradeShadowsAmount !== 0 || value.gradeMidAmount !== 0 || value.gradeHighlightsAmount !== 0,
    detail: value.clarity !== 0 || value.texture !== 0 || value.sharpen !== 0 || value.denoise !== 0,
  }

  return (
    <div className="workspace-color-modules">
      <WhiteBalancePanel value={value} modified={modified.whiteBalance} onChange={onChange} onActivatePipette={onActivatePipette} />
      <TonePanel value={value} modified={modified.tone} onChange={onChange} />
      <CurvePanel value={value} modified={modified.curve} onChange={onChange} />
      <HslPanel value={value} mode={hslMode} modified={modified.hsl} onModeChange={setHslMode} onChange={onChange} />
      <GradingPanel value={value} modified={modified.grading} onChange={onChange} />
      <DetailPanel value={value} modified={modified.detail} onChange={onChange} />
    </div>
  )
}
