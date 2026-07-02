import { FlipHorizontal2, FlipVertical2, Lock, RotateCcw, RotateCw, Unlock } from 'lucide-react'
import { useState } from 'react'

import type { EditPipeline } from '../shared/editPipeline'
import { IconButton, Input, Select, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'

export type CropPreset = 'original' | 'free' | '1:1' | '3:4' | '4:5' | '5:7' | '2:3' | '16:9' | 'custom'

interface TransformPanelProps {
  value: EditPipeline['transform']
  cropPreset: CropPreset
  cropWidth: number
  cropHeight: number
  onChange: (patch: Partial<EditPipeline['transform']>) => void
  onRotateChange: (rotate: number) => void
  onCropPresetChange: (preset: CropPreset) => void
  onCropSizeChange: (size: { width?: number; height?: number }) => void
}

function rotateLeft(current: number): number {
  return ((current - 90) % 360 + 360) % 360
}

function rotateRight(current: number): number {
  return ((current + 90) % 360) % 360
}

const CROP_PRESETS: Array<{ value: CropPreset; label: string }> = [
  { value: 'original', label: '原始尺寸' },
  { value: 'free', label: '自由尺寸' },
  { value: '1:1', label: '1 : 1' },
  { value: '3:4', label: '3 : 4' },
  { value: '4:5', label: '4 : 5' },
  { value: '5:7', label: '5 : 7' },
  { value: '2:3', label: '2 : 3' },
  { value: '16:9', label: '16 : 9' },
  { value: 'custom', label: '自定义分辨率' },
]

export function TransformPanel({
  value,
  cropPreset,
  cropWidth,
  cropHeight,
  onChange,
  onRotateChange,
  onCropPresetChange,
  onCropSizeChange,
}: TransformPanelProps) {
  const [aspectLocked, setAspectLocked] = useState(true)
  const cropRatio = Math.max(1, cropWidth) / Math.max(1, cropHeight)

  function handleWidthChange(widthValue: number): void {
    const width = Math.max(1, Math.round(widthValue))
    onCropSizeChange(aspectLocked ? { width, height: Math.max(1, Math.round(width / cropRatio)) } : { width })
  }

  function handleHeightChange(heightValue: number): void {
    const height = Math.max(1, Math.round(heightValue))
    onCropSizeChange(aspectLocked ? { width: Math.max(1, Math.round(height * cropRatio)), height } : { height })
  }

  return (
    <div className="workspace-panel-stack">
      <Select
        variant="compact"
        fullWidth
        options={CROP_PRESETS}
        value={cropPreset}
        onValueChange={(next) => onCropPresetChange(next as CropPreset)}
      />
      <div className="workspace-crop-size-row">
        <Tooltip content={aspectLocked ? '解除比例锁定' : '锁定当前比例'}>
          <IconButton
            variant={aspectLocked ? 'outline' : 'ghost'}
            size="mini"
            icon={aspectLocked ? <Lock size={13} /> : <Unlock size={13} />}
            aria-label={aspectLocked ? '解除比例锁定' : '锁定当前比例'}
            onClick={() => setAspectLocked((current) => !current)}
          />
        </Tooltip>
        <Input
          variant="compact"
          type="number"
          min={1}
          value={cropWidth}
          aria-label="裁剪宽度"
          onChange={(event) => handleWidthChange(Number(event.currentTarget.value))}
        />
        <span>×</span>
        <Input
          variant="compact"
          type="number"
          min={1}
          value={cropHeight}
          aria-label="裁剪高度"
          onChange={(event) => handleHeightChange(Number(event.currentTarget.value))}
        />
      </div>
      <div className="workspace-button-row">
        <Tooltip content="水平翻转">
          <IconButton
            variant={value.flipH ? 'outline' : 'ghost'}
            size="compact"
            icon={<FlipHorizontal2 size={16} />}
            onClick={() => onChange({ flipH: !value.flipH })}
          />
        </Tooltip>
        <Tooltip content="垂直翻转">
          <IconButton
            variant={value.flipV ? 'outline' : 'ghost'}
            size="compact"
            icon={<FlipVertical2 size={16} />}
            onClick={() => onChange({ flipV: !value.flipV })}
          />
        </Tooltip>
        <Tooltip content="左旋转 90°">
          <IconButton
            variant="ghost"
            size="compact"
            icon={<RotateCcw size={16} />}
            onClick={() => onChange({ orientation: rotateLeft(value.orientation) })}
          />
        </Tooltip>
        <Tooltip content="右旋转 90°">
          <IconButton
            variant="ghost"
            size="compact"
            icon={<RotateCw size={16} />}
            onClick={() => onChange({ orientation: rotateRight(value.orientation) })}
          />
        </Tooltip>
      </div>
      <ParamSlider label="旋转" value={value.rotate} min={-180} max={180} step={0.5} onChange={onRotateChange} formatValue={(next) => `${next}°`} />
    </div>
  )
}
