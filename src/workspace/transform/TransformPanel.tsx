import { FlipHorizontal2, FlipVertical2, RotateCcw, Scan } from 'lucide-react'

import type { EditPipeline } from '../shared/editPipeline'
import { Button, IconButton, Tooltip } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'

interface TransformPanelProps {
  value: EditPipeline['transform']
  cropActive: boolean
  onChange: (patch: Partial<EditPipeline['transform']>) => void
  onReset: () => void
  onToggleCrop: () => void
}

export function TransformPanel({ value, cropActive, onChange, onReset, onToggleCrop }: TransformPanelProps) {
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
      </div>

      <ParamSlider label="旋转" value={value.rotate} min={-180} max={180} onChange={(rotate) => onChange({ rotate })} formatValue={(next) => `${next}°`} />
      <ParamSlider label="缩放" value={value.scale} min={0.1} max={10} step={0.1} onChange={(scale) => onChange({ scale })} formatValue={(next) => `${next.toFixed(1)}x`} />

      <div className="workspace-panel-actions">
        <Button variant="ghost" size="mini" icon={<RotateCcw size={13} />} onClick={onReset}>重置几何</Button>
      </div>
    </div>
  )
}
