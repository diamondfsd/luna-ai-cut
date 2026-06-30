import { useState } from 'react'

import type { EditPipeline, SelectiveColorChannel } from '../shared/editPipeline'
import { CalibrationPanel } from './CalibrationPanel'
import { ColorEditorPanel } from './ColorEditorPanel'
import { CurvePanel } from './CurvePanel'
import { DetailPanel } from './DetailPanel'
import { GrainPanel } from './GrainPanel'
import { GradingPanel } from './GradingPanel'
import { HslPanel } from './HslPanel'
import { LensPanel } from './LensPanel'
import { SelectiveColorPanel } from './SelectiveColorPanel'
import { TonePanel } from './TonePanel'
import { WhiteBalancePanel } from './WhiteBalancePanel'
import { HSL_CHANNELS, SELECTIVE_CHANNELS } from './colorPanelShared'

interface ColorPanelProps {
  value: EditPipeline['color']
  effects: EditPipeline['effects']
  onChange: (patch: Partial<EditPipeline['color']>) => void
  onEffectsChange: (patch: Partial<EditPipeline['effects']>) => void
  onActivatePipette?: () => void
}

export function ColorPanel({ value, effects, onChange, onEffectsChange, onActivatePipette }: ColorPanelProps) {
  const [hslMode, setHslMode] = useState<'hue' | 'saturation' | 'luminance'>('hue')
  const [selectiveChannel, setSelectiveChannel] = useState<SelectiveColorChannel>('red')
  const activeCurve = value.curve.channels[value.curve.activeChannel]

  const modified = {
    whiteBalance: value.temperature !== 0 || value.tint !== 0 || value.whiteBalanceMode !== 'custom',
    tone: value.exposure !== 0 || value.contrast !== 0 || value.brightness !== 0 ||
           value.highlights !== 0 || value.shadows !== 0 || value.whites !== 0 || value.blacks !== 0 ||
           value.texture !== 0 || value.clarity !== 0 || value.dehaze !== 0 ||
           value.vibrance !== 0 || value.saturation !== 0,
    curve: activeCurve.highlights !== 0 || activeCurve.lights !== 0 || activeCurve.darks !== 0 || activeCurve.shadows !== 0,
    hsl: HSL_CHANNELS.some((ch) => value.hsl[ch.key].hue !== 0 || value.hsl[ch.key].saturation !== 0 || value.hsl[ch.key].luminance !== 0),
    colorEditor: value.colorEditor.hue !== 224 || value.colorEditor.saturation !== 54 || value.colorEditor.smoothing !== 50 ||
                 value.colorEditor.luminanceSmoothing !== 50 || value.colorEditor.hueOffset !== 0 ||
                 value.colorEditor.saturationOffset !== 0 || value.colorEditor.brightnessOffset !== 0 || value.colorEditor.uniformity !== 0,
    grading: value.grading.shadowsSaturation !== 0 || value.grading.midtonesSaturation !== 0 || value.grading.highlightsSaturation !== 0 ||
             value.grading.blending !== 50 || value.grading.balance !== 0,
    selectiveColor: SELECTIVE_CHANNELS.some((ch) =>
      value.selectiveColor[ch.key].cyan !== 0 || value.selectiveColor[ch.key].magenta !== 0 ||
      value.selectiveColor[ch.key].yellow !== 0 || value.selectiveColor[ch.key].black !== 0
    ) || value.selectiveColorMode !== 'relative',
    calibration: value.calibration.redHue !== 0 || value.calibration.redSaturation !== 0 ||
                 value.calibration.greenHue !== 0 || value.calibration.greenSaturation !== 0 ||
                 value.calibration.blueHue !== 0 || value.calibration.blueSaturation !== 0,
    detail: effects.sharpen !== 0 || effects.sharpenRadius !== 1 || effects.sharpenDetail !== 25 ||
            effects.sharpenMasking !== 0 || effects.noiseReduction !== 0 || effects.colorNoiseReduction !== 0,
    grain: effects.grainAmount !== 0 || effects.grainSize !== 25 || effects.grainRoughness !== 50,
    lens: effects.lensVignetting !== 0 || effects.vignette !== 0 || effects.chromaticAberration !== 0,
  }

  return (
    <div className="workspace-color-modules">
      <WhiteBalancePanel value={value} modified={modified.whiteBalance} onChange={onChange} onActivatePipette={onActivatePipette} />
      <TonePanel value={value} modified={modified.tone} onChange={onChange} />
      <CurvePanel value={value} modified={modified.curve} onChange={onChange} />
      <HslPanel value={value} mode={hslMode} modified={modified.hsl} onModeChange={setHslMode} onChange={onChange} />
      <ColorEditorPanel value={value} modified={modified.colorEditor} onChange={onChange} />
      <GradingPanel value={value} modified={modified.grading} onChange={onChange} />
      <SelectiveColorPanel value={value} channel={selectiveChannel} modified={modified.selectiveColor} onChannelChange={setSelectiveChannel} onChange={onChange} />
      <CalibrationPanel value={value} modified={modified.calibration} onChange={onChange} />
      <DetailPanel effects={effects} modified={modified.detail} onEffectsChange={onEffectsChange} />
      <GrainPanel effects={effects} modified={modified.grain} onEffectsChange={onEffectsChange} />
      <LensPanel effects={effects} modified={modified.lens} onEffectsChange={onEffectsChange} />
    </div>
  )
}
