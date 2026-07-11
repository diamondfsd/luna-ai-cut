import { Button, Input, Switch } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import type { EditPipeline } from '../shared/editPipeline'
import { FRAME_PRESETS } from './buildBorderLayer'
import '../../styles/workspace-border.css'

interface BorderPanelProps {
  value: EditPipeline['border']
  onChange: (patch: Partial<EditPipeline['border']>) => void
}

function presetColors(presetId: string): { backgroundColor: string; textColor: string } {
  const preset = FRAME_PRESETS.find((item) => item.id === presetId)
  const background = preset?.layers.find((layer) => layer.type === 'shape' && layer.id === 'background')
  const text = preset?.layers.find((layer) => layer.type === 'text')
  return {
    backgroundColor: background?.type === 'shape' ? background.fill?.color ?? preset?.swatch ?? '#ffffff' : preset?.swatch ?? '#ffffff',
    textColor: text?.type === 'text' ? text.style.color : '#222222',
  }
}

export function BorderPanel({ value, onChange }: BorderPanelProps) {
  return (
    <div className="workspace-border-panel">
      <div className="workspace-border-header">
        <span className="eyebrow">边框</span>
        <Switch checked={value.enabled} onCheckedChange={(enabled) => onChange({ enabled })} ariaLabel="启用边框" />
      </div>

      <div className="workspace-border-presets" aria-label="边框预设">
        {FRAME_PRESETS.map((preset) => (
          <Button
            variant="ghost"
            size="compact"
            key={preset.id}
            className="workspace-border-preset"
            data-active={value.enabled && value.presetId === preset.id}
            onClick={() => onChange({ enabled: true, presetId: preset.id, ...presetColors(preset.id) })}
          >
            <span className="workspace-border-preset-preview" style={{ background: preset.swatch }}>
              <span style={{ color: presetColors(preset.id).textColor }}>LUNA</span>
            </span>
            <span>{preset.name}</span>
          </Button>
        ))}
      </div>

      {value.enabled && (
        <div className="workspace-border-controls">
          <span className="workspace-border-section-title">微调</span>
          <div className="workspace-border-color-row">
            <span>背景颜色</span>
            <label className="workspace-border-color-picker">
              <input type="color" value={value.backgroundColor} onChange={(event) => onChange({ backgroundColor: event.currentTarget.value })} />
              <span className="workspace-border-color-swatch" style={{ background: value.backgroundColor }} />
              <span>{value.backgroundColor}</span>
            </label>
          </div>
          <div className="workspace-border-color-row">
            <span>文字颜色</span>
            <label className="workspace-border-color-picker">
              <input type="color" value={value.textColor} onChange={(event) => onChange({ textColor: event.currentTarget.value })} />
              <span className="workspace-border-color-swatch" style={{ background: value.textColor }} />
              <span>{value.textColor}</span>
            </label>
          </div>
          <ParamSlider label="边框尺寸" value={value.frameSize} min={70} max={135} step={1} onChange={(frameSize) => onChange({ frameSize })} formatValue={(number) => `${number}%`} />
          <ParamSlider label="不透明度" value={value.opacity} min={20} max={100} step={1} onChange={(opacity) => onChange({ opacity })} formatValue={(number) => `${number}%`} />
          <Input variant="compact" fullWidth value={value.title} onChange={(event) => onChange({ title: event.currentTarget.value })} placeholder="作品标题" aria-label="作品标题" />
          <div className="workspace-border-switches">
            <label><span>显示标志</span><Switch checked={value.showLogo} onCheckedChange={(showLogo) => onChange({ showLogo })} ariaLabel="显示标志" /></label>
            <label><span>显示标题</span><Switch checked={value.showTitle} onCheckedChange={(showTitle) => onChange({ showTitle })} ariaLabel="显示标题" /></label>
            <label><span>显示拍摄信息</span><Switch checked={value.showCameraInfo} onCheckedChange={(showCameraInfo) => onChange({ showCameraInfo })} ariaLabel="显示拍摄信息" /></label>
          </div>
        </div>
      )}
    </div>
  )
}
