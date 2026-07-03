import { ArrowDown, ArrowUp, RotateCcw, ZoomIn } from 'lucide-react'

import { IconButton } from '../../../ui'

interface TripleStitchSlotToolsProps {
  slot: number
  onMove: (from: number, to: number) => void
  onZoom: (slot: number) => void
  onReset: (slot: number) => void
}

export function TripleStitchSlotTools({
  slot,
  onMove,
  onZoom,
  onReset,
}: TripleStitchSlotToolsProps) {
  return (
    <div className="triple-stitch-slot-tools">
      <IconButton
        className="triple-stitch-slot-tool"
        variant="light"
        size="mini"
        icon={<ArrowUp size={13} />}
        disabled={slot === 0}
        onClick={(event) => {
          event.stopPropagation()
          onMove(slot, slot - 1)
        }}
        title="上移"
      />
      <IconButton
        className="triple-stitch-slot-tool"
        variant="light"
        size="mini"
        icon={<ZoomIn size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onZoom(slot)
        }}
        title="放大"
      />
      <IconButton
        className="triple-stitch-slot-tool"
        variant="light"
        size="mini"
        icon={<RotateCcw size={13} />}
        onClick={(event) => {
          event.stopPropagation()
          onReset(slot)
        }}
        title="重置"
      />
      <IconButton
        className="triple-stitch-slot-tool"
        variant="light"
        size="mini"
        icon={<ArrowDown size={13} />}
        disabled={slot === 2}
        onClick={(event) => {
          event.stopPropagation()
          onMove(slot, slot + 1)
        }}
        title="下移"
      />
    </div>
  )
}
