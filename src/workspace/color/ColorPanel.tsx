import type { EditPipeline } from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'

interface ColorPanelProps {
  value: EditPipeline['color']
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

const MAIN_CONTROLS = [
  ['曝光', 'exposure', -5, 5, 0.1],
  ['对比度', 'contrast', -100, 100, 1],
  ['饱和度', 'saturation', -100, 100, 1],
] as const

const LIGHT_CONTROLS = [
  ['高光', 'highlights', -100, 100, 1],
  ['阴影', 'shadows', -100, 100, 1],
  ['白色', 'whites', -100, 100, 1],
  ['黑色', 'blacks', -100, 100, 1],
] as const

const COLOR_CONTROLS = [
  ['色温', 'temperature', -100, 100, 1],
  ['色调', 'tint', -100, 100, 1],
  ['自然饱和', 'vibrance', -100, 100, 1],
  ['清晰度', 'clarity', -100, 100, 1],
  ['去雾', 'dehaze', -100, 100, 1],
] as const

export function ColorPanel({ value, onChange }: ColorPanelProps) {
  return (
    <div className="workspace-panel-stack">
      {MAIN_CONTROLS.map(([label, key, min, max, step]) => (
        <ParamSlider
          key={key}
          label={label}
          value={value[key]}
          min={min}
          max={max}
          step={step}
          onChange={(next) => onChange({ [key]: next })}
          formatValue={(next) => (key === 'exposure' ? `${next > 0 ? '+' : ''}${next.toFixed(1)}` : `${next > 0 ? '+' : ''}${next}`)}
        />
      ))}

      <div className="workspace-param-group-title">光影</div>
      {LIGHT_CONTROLS.map(([label, key, min, max, step]) => (
        <ParamSlider key={key} label={label} value={value[key]} min={min} max={max} step={step} onChange={(next) => onChange({ [key]: next })} />
      ))}

      <div className="workspace-param-group-title">色彩</div>
      {COLOR_CONTROLS.map(([label, key, min, max, step]) => (
        <ParamSlider key={key} label={label} value={value[key]} min={min} max={max} step={step} onChange={(next) => onChange({ [key]: next })} />
      ))}
    </div>
  )
}
