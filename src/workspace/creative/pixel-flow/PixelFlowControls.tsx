import { Play, RotateCcw } from 'lucide-react'

import { Button, IconButton } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'

interface PixelFlowControlsProps {
  duration: number
  pixelCount: number
  lightWidth: number
  bloomStrength: number
  filterStrength: number
  colorTransition: number
  rainSpeed: number
  rainLength: number
  flowStrength: number
  subjectDelay: number
  disabled: boolean
  onDurationChange: (value: number) => void
  onPixelCountChange: (value: number) => void
  onLightWidthChange: (value: number) => void
  onBloomStrengthChange: (value: number) => void
  onFilterStrengthChange: (value: number) => void
  onColorTransitionChange: (value: number) => void
  onRainSpeedChange: (value: number) => void
  onRainLengthChange: (value: number) => void
  onFlowStrengthChange: (value: number) => void
  onSubjectDelayChange: (value: number) => void
  onReset: () => void
  onReplay: () => void
}

export function PixelFlowControls(props: PixelFlowControlsProps) {
  return <aside className="pixel-flow-panel">
    <div className="pixel-flow-panel-head">
      <strong>效果设置</strong>
      <span>细密像素从上方落下，经过画面层次后还原原有色彩</span>
    </div>
    <div className="pixel-flow-options">
      <ParamSlider label="效果时长" value={props.duration} min={0.7} max={2} step={0.05} onChange={props.onDurationChange} formatValue={(value) => `${value.toFixed(2)}s`} />
      <ParamSlider label="下落速度" value={props.rainSpeed} min={20} max={100} onChange={props.onRainSpeedChange} />
      <ParamSlider label="雨尾长度" value={props.rainLength} min={10} max={100} onChange={props.onRainLengthChange} />
      <ParamSlider label="表面流量" value={props.flowStrength} min={20} max={100} onChange={props.onFlowStrengthChange} />
      <ParamSlider label="主体延迟" value={props.subjectDelay} min={0} max={100} onChange={props.onSubjectDelayChange} />
      <ParamSlider label="像素密度" value={props.pixelCount} min={120} max={360} step={4} onChange={props.onPixelCountChange} formatValue={(value) => `${Math.round(value)}个`} />
      <ParamSlider label="像素亮度" value={props.lightWidth} min={2} max={16} onChange={props.onLightWidthChange} formatValue={(value) => `${Math.round(value)}%`} />
      <ParamSlider label="赫兹色彩" value={props.filterStrength} min={0} max={100} onChange={props.onFilterStrengthChange} />
      <ParamSlider label="CCD 泛光" value={props.bloomStrength} min={0} max={100} onChange={props.onBloomStrengthChange} />
      <ParamSlider label="色彩过渡" value={props.colorTransition} min={0.1} max={1} step={1 / 60} onChange={props.onColorTransitionChange} formatValue={(value) => `${Math.round(value * 60)}帧`} />
    </div>
    <div className="pixel-flow-actions">
      <IconButton variant="ghost" size="mini" icon={<RotateCcw size={14} />} title="重置参数" aria-label="重置参数" onClick={props.onReset} />
      <Button variant="primary" size="compact" icon={<Play size={14} />} disabled={props.disabled} onClick={props.onReplay}>播放效果</Button>
    </div>
  </aside>
}
