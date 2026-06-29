import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw, Scan } from 'lucide-react'

import type { EditPipeline } from '../shared/editPipeline'
import { Button, IconButton, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'

interface TransformPanelProps {
  value: EditPipeline['transform']
  cropActive: boolean
  onChange: (patch: Partial<EditPipeline['transform']>) => void
  onToggleCrop: () => void
}

function rotateLeft(current: number): number {
  return ((current - 90) % 360 + 360) % 360
}

function rotateRight(current: number): number {
  return ((current + 90) % 360) % 360
}

export function TransformPanel({ value, cropActive, onChange, onToggleCrop }: TransformPanelProps) {
  return (
    <div className="workspace-panel-stack">
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
            onClick={() => onChange({ rotate: rotateLeft(value.rotate) })}
          />
        </Tooltip>
        <Tooltip content="右旋转 90°">
          <IconButton
            variant="ghost"
            size="compact"
            icon={<RotateCw size={16} />}
            onClick={() => onChange({ rotate: rotateRight(value.rotate) })}
          />
        </Tooltip>
      </div>
      <ParamSlider label="旋转" value={value.rotate} min={-180} max={180} onChange={(rotate) => onChange({ rotate })} formatValue={(next) => `${next}°`} />
    </div>
  )
}
