import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { SubjectBounds } from './pixelStretchLayers'

export interface PixelStretchSampleEditorValue {
  rangeStart: number
  rangeEnd: number
  anchorStart: number
  anchorEnd: number
  controlStartOffset: number
  controlEndOffset: number
}

type EditableKey = keyof PixelStretchSampleEditorValue

interface PixelStretchSampleEditorProps {
  bounds: SubjectBounds
  horizontal: boolean
  value: PixelStretchSampleEditorValue
  onChange: (key: EditableKey, value: number) => void
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function PixelStretchSampleEditor({ bounds, horizontal, value, onChange }: PixelStretchSampleEditorProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<EditableKey | null>(null)
  const start = value.anchorStart / 100
  const end = value.anchorEnd / 100
  const controlStart = clamp(value.anchorStart + (value.anchorEnd - value.anchorStart) / 3 + value.controlStartOffset) / 100
  const controlEnd = clamp(value.anchorStart + (value.anchorEnd - value.anchorStart) * 2 / 3 + value.controlEndOffset) / 100
  const rangeStart = value.rangeStart / 100
  const rangeEnd = value.rangeEnd / 100
  const p0 = horizontal
    ? { x: bounds.x + bounds.w * start, y: bounds.y + bounds.h * rangeStart }
    : { x: bounds.x + bounds.w * rangeStart, y: bounds.y + bounds.h * start }
  const p1 = horizontal
    ? { x: bounds.x + bounds.w * controlStart, y: bounds.y + bounds.h * (rangeStart + (rangeEnd - rangeStart) / 3) }
    : { x: bounds.x + bounds.w * (rangeStart + (rangeEnd - rangeStart) / 3), y: bounds.y + bounds.h * controlStart }
  const p2 = horizontal
    ? { x: bounds.x + bounds.w * controlEnd, y: bounds.y + bounds.h * (rangeStart + (rangeEnd - rangeStart) * 2 / 3) }
    : { x: bounds.x + bounds.w * (rangeStart + (rangeEnd - rangeStart) * 2 / 3), y: bounds.y + bounds.h * controlEnd }
  const p3 = horizontal
    ? { x: bounds.x + bounds.w * end, y: bounds.y + bounds.h * rangeEnd }
    : { x: bounds.x + bounds.w * rangeEnd, y: bounds.y + bounds.h * end }

  function beginDrag(key: EditableKey, event: ReactPointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    setDragging(key)
    overlayRef.current?.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging || !overlayRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const rect = overlayRef.current.getBoundingClientRect()
    const x = clamp((event.clientX - rect.left) / rect.width * 100, bounds.x * 100, (bounds.x + bounds.w) * 100)
    const y = clamp((event.clientY - rect.top) / rect.height * 100, bounds.y * 100, (bounds.y + bounds.h) * 100)
    const cross = horizontal ? (x / 100 - bounds.x) / bounds.w * 100 : (y / 100 - bounds.y) / bounds.h * 100
    const along = horizontal ? (y / 100 - bounds.y) / bounds.h * 100 : (x / 100 - bounds.x) / bounds.w * 100
    if (dragging === 'anchorStart') {
      onChange('anchorStart', clamp(cross))
      onChange('rangeStart', clamp(along))
    } else if (dragging === 'anchorEnd') {
      onChange('anchorEnd', clamp(cross))
      onChange('rangeEnd', clamp(along))
    } else if (dragging === 'controlStartOffset') {
      onChange(dragging, clamp(cross) - (value.anchorStart + (value.anchorEnd - value.anchorStart) / 3))
    } else {
      onChange(dragging, clamp(cross) - (value.anchorStart + (value.anchorEnd - value.anchorStart) * 2 / 3))
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    event.preventDefault()
    event.stopPropagation()
    setDragging(null)
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) overlayRef.current.releasePointerCapture(event.pointerId)
  }

  const path = (first: { x: number; y: number }, second: { x: number; y: number }) =>
    `M ${first.x * 100} ${first.y * 100} L ${second.x * 100} ${second.y * 100}`

  return <div ref={overlayRef} className="pixel-stretch-sample-editor" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="pixel-stretch-control-line" d={path(p0, p1)} />
      <path className="pixel-stretch-control-line" d={path(p3, p2)} />
      <path className="pixel-stretch-sample-curve" d={`M ${p0.x * 100} ${p0.y * 100} C ${p1.x * 100} ${p1.y * 100}, ${p2.x * 100} ${p2.y * 100}, ${p3.x * 100} ${p3.y * 100}`} />
    </svg>
    {([
      ['anchorStart', p0, '取色起点'],
      ['anchorEnd', p3, '取色终点'],
      ['controlStartOffset', p1, '起点曲率'],
      ['controlEndOffset', p2, '终点曲率'],
    ] as const).map(([key, point, label]) => <button key={key} type="button" className={`pixel-stretch-pen-point ${key.includes('control') ? 'is-control' : 'is-anchor'}`} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} aria-label={label} title={label} onPointerDown={(event) => beginDrag(key, event)} />)}
  </div>
}
