import { X } from 'lucide-react'

import { IconButton } from '../../../ui'
import { ParamSlider } from '../../components/ParamSlider'

interface TripleStitchLiveRangeBarProps {
  slot: number
  duration: number
  value: number
  onChange: (value: number) => void
  onClose?: () => void
}

export function TripleStitchLiveRangeBar({
  slot,
  duration,
  value,
  onChange,
  onClose,
}: TripleStitchLiveRangeBarProps) {
  const maxStart = Math.max(0, duration - 3)
  return (
    <div className="triple-stitch-live-range">
      <div className="triple-stitch-live-range-head">
        <span>第 {slot + 1} 段 Live 片段</span>
        <strong>{value.toFixed(1)}s - {(value + 3).toFixed(1)}s</strong>
        {onClose && <IconButton variant="ghost" size="mini" icon={<X size={13} />} onClick={onClose} title="关闭" />}
      </div>
      <ParamSlider
        label="起点"
        value={Number(value.toFixed(1))}
        min={0}
        max={maxStart}
        step={0.1}
        onChange={onChange}
        formatValue={(next) => `${next.toFixed(1)} 秒`}
      />
    </div>
  )
}
