import { Download, RotateCcw } from 'lucide-react'

import { Button, IconButton } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'

interface PixelFlowControlsProps {
  duration: number
  pixelCount: number
  lightWidth: number
  initialSaturation: number
  initialBrightness: number
  disabled: boolean
  exporting: boolean
  onDurationChange: (value: number) => void
  onPixelCountChange: (value: number) => void
  onLightWidthChange: (value: number) => void
  onInitialSaturationChange: (value: number) => void
  onInitialBrightnessChange: (value: number) => void
  onReset: () => void
  onExport: () => void
}

export function PixelFlowControls(props: PixelFlowControlsProps) {
  return <aside className="pixel-flow-panel">
    <div className="pixel-flow-panel-head">
      <strong>效果设置</strong>
    </div>
    <div className="pixel-flow-options">
      <ParamSlider label="效果时长" value={props.duration} min={0.7} max={3} step={0.05} onChange={props.onDurationChange} formatValue={(value) => `${value.toFixed(2)}s`} />
      <ParamSlider label="像素密度" value={props.pixelCount} min={120} max={360} step={4} onChange={props.onPixelCountChange} formatValue={(value) => `${Math.round(value)}个`} />
      <ParamSlider label="像素亮度" value={props.lightWidth} min={2} max={16} onChange={props.onLightWidthChange} formatValue={(value) => `${Math.round(value)}%`} />
      <ParamSlider label="初始饱和度" value={props.initialSaturation} min={0} max={100} onChange={props.onInitialSaturationChange} />
      <ParamSlider label="初始亮度" value={props.initialBrightness} min={-100} max={100} onChange={props.onInitialBrightnessChange} />
    </div>
    <div className="pixel-flow-actions">
      <IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={props.onReset} />
      <Button variant="primary" size="compact" icon={<Download size={14} />} disabled={props.disabled || props.exporting} onClick={props.onExport}>{props.exporting ? '加入中' : '导出'}</Button>
    </div>
  </aside>
}
