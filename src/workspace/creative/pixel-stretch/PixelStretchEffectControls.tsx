import { PenTool, Route } from 'lucide-react'

import type { PixelStretchFlowShape, PixelStretchPresetId } from '../../../shared/types/workspace'
import { Button, SegmentedControl } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'
import './pixel-stretch-effect-controls.css'

interface PixelStretchEffectControlsProps {
  disabled: boolean
  preset: PixelStretchPresetId
  flowShape: PixelStretchFlowShape
  sampleEditing: boolean
  pathEditing: boolean
  sampleCoordinate: number
  sampleCoordinateHalfSpan: number
  angle: number
  flowLength: number
  flowCurve: number
  flowWidth: number
  flowEndWidth: number
  horizontal: boolean
  onPresetChange: (value: PixelStretchPresetId) => void
  onFlowShapeChange: (value: PixelStretchFlowShape) => void
  onToggleSampleEditing: () => void
  onTogglePathEditing: () => void
  onResetSample: () => void
  onSampleCoordinateChange: (value: number) => void
  onAngleChange: (value: number) => void
  onFlowLengthChange: (value: number) => void
  onFlowCurveChange: (value: number) => void
  onFlowWidthChange: (value: number) => void
  onFlowEndWidthChange: (value: number) => void
}

export function PixelStretchEffectControls(props: PixelStretchEffectControlsProps) {
  const shaped = props.flowShape !== 'straight'
  return <fieldset className="pixel-stretch-effect-controls" disabled={props.disabled}>
    <span>拉伸方向</span>
    <SegmentedControl className="pixel-stretch-presets" ariaLabel="像素拉伸方向" value={props.preset} options={[
      { value: 'left', label: '左边' }, { value: 'right', label: '右边' }, { value: 'top', label: '上面' },
      { value: 'bottom', label: '下面' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' },
    ]} onChange={props.onPresetChange} />
    <span>流线造型</span>
    <SegmentedControl className="pixel-stretch-flow-presets" ariaLabel="流线造型" value={props.flowShape} options={[
      { value: 'straight', label: '直线' }, { value: 'arc', label: '半圆' }, { value: 'cape', label: '披风' },
      { value: 's-curve', label: 'S 型' }, { value: 'custom', label: '自定义' },
    ]} onChange={props.onFlowShapeChange} />
    <div className="pixel-stretch-edit-row">
      <Button variant={props.sampleEditing ? 'primary' : 'secondary'} size="compact" icon={<PenTool size={14} />} onClick={props.onToggleSampleEditing}>{props.sampleEditing ? '完成取色编辑' : '编辑取色范围'}</Button>
      {props.flowShape === 'custom' && <Button variant={props.pathEditing ? 'primary' : 'secondary'} size="compact" icon={<Route size={14} />} onClick={props.onTogglePathEditing}>{props.pathEditing ? '完成流线编辑' : '编辑流线路径'}</Button>}
      <Button variant="ghost" size="compact" onClick={props.onResetSample}>还原</Button>
    </div>
    <ParamSlider label={`整体取色${props.horizontal ? '横' : '纵'}坐标`} value={props.sampleCoordinate} min={props.sampleCoordinateHalfSpan} max={100 - props.sampleCoordinateHalfSpan} step={1} onChange={props.onSampleCoordinateChange} formatValue={(value) => `${Math.round(value)}%`} />
    <ParamSlider label="中心旋转" value={props.angle} min={-180} max={180} step={1} onChange={props.onAngleChange} formatValue={(value) => `${value}°`} />
    {shaped && <>
      {props.flowShape !== 'custom' && <ParamSlider label="延伸长度" value={props.flowLength} min={10} max={150} step={1} onChange={props.onFlowLengthChange} formatValue={(value) => `${value}%`} />}
      {props.flowShape !== 'custom' && <ParamSlider label="弯曲程度" value={props.flowCurve} min={0} max={100} step={1} onChange={props.onFlowCurveChange} formatValue={(value) => `${value}%`} />}
      <ParamSlider label="起点宽度" value={props.flowWidth} min={10} max={150} step={1} onChange={props.onFlowWidthChange} formatValue={(value) => `${value}%`} />
      <ParamSlider label="末端宽度" value={props.flowEndWidth} min={0} max={150} step={1} onChange={props.onFlowEndWidthChange} formatValue={(value) => `${value}%`} />
    </>}
  </fieldset>
}
