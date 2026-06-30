import { RotateCcw } from 'lucide-react'

import { COLOR_EDITOR_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion } from '../../ui'
import { ColorWheel, hueColor } from './colorPanelShared'

interface ColorEditorPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function ColorEditorPanel({ value, modified, onChange }: ColorEditorPanelProps) {
  return (
    <Accordion
      title="色彩编辑器"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(COLOR_EDITOR_DEFAULTS)} title="重置色彩编辑器">
          <RotateCcw size={11} />
        </button>
      }
    >
      <div className="workspace-editor-wheel-row">
        <ColorWheel
          label="色彩编辑器"
          hue={value.colorEditor.hue}
          saturation={value.colorEditor.saturation}
          onChange={(hue, saturation) => onChange({ colorEditor: { ...value.colorEditor, hue, saturation } })}
        />
        <div className="workspace-editor-color-readout">
          <span style={{ background: hueColor(value.colorEditor.hue, value.colorEditor.saturation) }} />
          <strong>{value.colorEditor.hue}°</strong>
          <small>{value.colorEditor.saturation}%</small>
        </div>
      </div>
      <ParamSlider label="色彩平滑" value={value.colorEditor.smoothing} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.smoothing)} onChange={(smoothing) => onChange({ colorEditor: { ...value.colorEditor, smoothing } })} formatValue={String} />
      <ParamSlider label="亮度平滑" value={value.colorEditor.luminanceSmoothing} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.luminanceSmoothing)} onChange={(luminanceSmoothing) => onChange({ colorEditor: { ...value.colorEditor, luminanceSmoothing } })} formatValue={String} />
      <ParamSlider label="色相偏移" value={value.colorEditor.hueOffset} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.hueOffset)} onChange={(hueOffset) => onChange({ colorEditor: { ...value.colorEditor, hueOffset } })} />
      <ParamSlider label="饱和偏移" value={value.colorEditor.saturationOffset} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.saturationOffset)} onChange={(saturationOffset) => onChange({ colorEditor: { ...value.colorEditor, saturationOffset } })} />
      <ParamSlider label="明度偏移" value={value.colorEditor.brightnessOffset} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.brightnessOffset)} onChange={(brightnessOffset) => onChange({ colorEditor: { ...value.colorEditor, brightnessOffset } })} />
      <ParamSlider label="色彩均匀度" value={value.colorEditor.uniformity} {...sliderRange(EDIT_PARAMETER_RANGES.colorEditor.uniformity)} onChange={(uniformity) => onChange({ colorEditor: { ...value.colorEditor, uniformity } })} formatValue={String} />
    </Accordion>
  )
}
