import { Pipette, RotateCcw } from 'lucide-react'

import { COLOR_EDITOR_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, IconButton, Tooltip, toast } from '../../ui'
import { ColorWheel, hueColor } from './colorPanelShared'

interface EyeDropperConstructor {
  new(): {
    open(): Promise<{ sRGBHex: string }>
  }
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor
  }
}

interface ColorEditorPanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function ColorEditorPanel({ value, modified, onChange }: ColorEditorPanelProps) {
  function pickColor(): void {
    if (typeof window.EyeDropper !== 'function') {
      toast.error('当前浏览器不支持取色器')
      return
    }
    const dropper = new window.EyeDropper()
    dropper.open().then(({ sRGBHex }) => {
      const r = parseInt(sRGBHex.slice(1, 3), 16) / 255
      const g = parseInt(sRGBHex.slice(3, 5), 16) / 255
      const b = parseInt(sRGBHex.slice(5, 7), 16) / 255
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const delta = max - min
      const saturation = max <= 0 ? 0 : Math.round((delta / max) * 100)
      let hue = 0
      if (delta > 0) {
        if (max === r) hue = ((g - b) / delta) % 6
        else if (max === g) hue = (b - r) / delta + 2
        else hue = (r - g) / delta + 4
      }
      const normalizedHue = Math.round((hue * 60 + 360) % 360)
      onChange({ colorEditor: { ...value.colorEditor, hue: normalizedHue, saturation } })
    }).catch(() => undefined)
  }

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
          <div className="workspace-editor-color-chip-row">
            <span style={{ background: hueColor(value.colorEditor.hue, value.colorEditor.saturation) }} />
            <Tooltip content="吸取颜色">
              <IconButton variant="ghost" size="compact" icon={<Pipette size={16} />} onClick={pickColor} />
            </Tooltip>
          </div>
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
