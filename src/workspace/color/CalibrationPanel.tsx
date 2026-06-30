import { RotateCcw } from 'lucide-react'

import { CALIBRATION_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'
import { ColorBarSlider } from './colorPanelShared'

interface CalibrationPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function CalibrationPanel({ value, modified, onChange }: CalibrationPanelProps) {
  return (
    <Accordion
      title="校准"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(CALIBRATION_DEFAULTS)} title="重置校准">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ColorBarSlider color="linear-gradient(90deg, #ff375f, #b6b6b6, #ff9f0a)">
        <ParamSlider label="红原色色相" value={value.calibration.redHue} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.redHue)} onChange={(redHue) => onChange({ calibration: { ...value.calibration, redHue } })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #30d158)">
        <ParamSlider label="红原色饱和" value={value.calibration.redSaturation} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.redSaturation)} onChange={(redSaturation) => onChange({ calibration: { ...value.calibration, redSaturation } })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #ffd60a, #b6b6b6, #30d158)">
        <ParamSlider label="绿原色色相" value={value.calibration.greenHue} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.greenHue)} onChange={(greenHue) => onChange({ calibration: { ...value.calibration, greenHue } })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #30d158)">
        <ParamSlider label="绿原色饱和" value={value.calibration.greenSaturation} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.greenSaturation)} onChange={(greenSaturation) => onChange({ calibration: { ...value.calibration, greenSaturation } })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #64d2ff, #b6b6b6, #bf5af2)">
        <ParamSlider label="蓝原色色相" value={value.calibration.blueHue} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.blueHue)} onChange={(blueHue) => onChange({ calibration: { ...value.calibration, blueHue } })} />
      </ColorBarSlider>
      <ColorBarSlider color="linear-gradient(90deg, #ff453a, #b6b6b6, #0a84ff)">
        <ParamSlider label="蓝原色饱和" value={value.calibration.blueSaturation} {...sliderRange(EDIT_PARAMETER_RANGES.calibration.blueSaturation)} onChange={(blueSaturation) => onChange({ calibration: { ...value.calibration, blueSaturation } })} />
      </ColorBarSlider>
    </Accordion>
  )
}
