import { ArrowDown, ArrowUp, Play, RotateCcw, ZoomIn } from 'lucide-react'

import { IconButton } from '../../../ui'

interface TripleStitchSlotToolsProps {
  slot: number
  dynamic: boolean
  onMove: (from: number, to: number) => void
  onZoom: (slot: number) => void
  onReset: (slot: number) => void
  onLiveRange: (slot: number) => void
}

export function TripleStitchSlotTools({
  slot,
  dynamic,
  onMove,
  onZoom,
  onReset,
  onLiveRange,
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
      {dynamic && (
        <IconButton
          className="triple-stitch-slot-tool"
          variant="light"
          size="mini"
          icon={<Play size={13} />}
          onClick={(event) => {
            event.stopPropagation()
            onLiveRange(slot)
          }}
          title="Live 片段"
        />
      )}
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
