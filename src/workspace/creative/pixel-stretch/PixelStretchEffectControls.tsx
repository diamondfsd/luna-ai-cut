import { PenTool } from 'lucide-react'

import type { PixelStretchPresetId } from '../../../shared/types/workspace'
import { Accordion, Button, SegmentedControl } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import './pixel-stretch-effect-controls.css'

interface PixelStretchEffectControlsProps {
  disabled: boolean
  preset: PixelStretchPresetId
  sampleEditing: boolean
  sampleCoordinate: number
  sampleCoordinateHalfSpan: number
  angle: number
  horizontal: boolean
  onPresetChange: (value: PixelStretchPresetId) => void
  onToggleSampleEditing: () => void
  onResetSample: () => void
  onSampleCoordinateChange: (value: number) => void
  onAngleChange: (value: number) => void
}

export function PixelStretchEffectControls(props: PixelStretchEffectControlsProps) {
  return <fieldset className="pixel-stretch-effect-controls" disabled={props.disabled}>
    <span>色带方向</span>
    <SegmentedControl className="pixel-stretch-presets" ariaLabel="像素拉伸方向" value={props.preset} options={[
      { value: 'left', label: '左边' }, { value: 'right', label: '右边' }, { value: 'top', label: '上面' },
      { value: 'bottom', label: '下面' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' },
    ]} onChange={props.onPresetChange} />
    <div className="pixel-stretch-edit-row">
      <Button variant={props.sampleEditing ? 'primary' : 'secondary'} size="compact" icon={<PenTool size={14} />} onClick={props.onToggleSampleEditing}>{props.sampleEditing ? '完成取色' : '调整取色'}</Button>
    </div>
    <Accordion className="pixel-stretch-advanced" title="细节调整">
      <div className="pixel-stretch-advanced-body">
        <ParamSlider label={`取色${props.horizontal ? '横' : '纵'}向位置`} value={props.sampleCoordinate} min={props.sampleCoordinateHalfSpan} max={100 - props.sampleCoordinateHalfSpan} step={1} onChange={props.onSampleCoordinateChange} formatValue={(value) => `${Math.round(value)}%`} />
        <ParamSlider label="色带角度" value={props.angle} min={-180} max={180} step={1} onChange={props.onAngleChange} formatValue={(value) => `${value}°`} />
        <Button variant="ghost" size="compact" onClick={props.onResetSample}>还原取色位置</Button>
      </div>
    </Accordion>
  </fieldset>
}
