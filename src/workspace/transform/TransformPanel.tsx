import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Scan } from 'lucide-react'

import type { EditPipeline } from '../shared/editPipeline'
import { Button, IconButton, Input, Select, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'

export type CropPreset = 'original' | 'free' | '1:1' | '3:4' | '4:5' | '5:7' | '2:3' | '16:9' | 'custom'

interface TransformPanelProps {
  value: EditPipeline['transform']
  cropActive: boolean
  cropPreset: CropPreset
  cropWidth: number
  cropHeight: number
  onChange: (patch: Partial<EditPipeline['transform']>) => void
  onRotateChange: (rotate: number) => void
  onCropPresetChange: (preset: CropPreset) => void
  onCropSizeChange: (size: { width?: number; height?: number }) => void
  onToggleCrop: () => void
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
  cropActive,
  cropPreset,
  cropWidth,
  cropHeight,
  onChange,
  onRotateChange,
  onCropPresetChange,
  onCropSizeChange,
  onToggleCrop,
}: TransformPanelProps) {
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
        <Input
          variant="compact"
          type="number"
          min={1}
          value={cropWidth}
          aria-label="裁剪宽度"
          onChange={(event) => onCropSizeChange({ width: Number(event.currentTarget.value) })}
        />
        <span>×</span>
        <Input
          variant="compact"
          type="number"
          min={1}
          value={cropHeight}
          aria-label="裁剪高度"
          onChange={(event) => onCropSizeChange({ height: Number(event.currentTarget.value) })}
        />
      </div>
      <div className="workspace-button-row">
        <Button variant={cropActive ? 'primary' : 'secondary'} size="compact" icon={<Scan size={14} />} onClick={onToggleCrop}>
          裁剪
        </Button>
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
