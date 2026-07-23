import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { PixelStretchPathPoint } from '../../../shared/types/workspace'
import { IconButton } from '../../../ui'
import './pixel-stretch-path-editor.css'

interface PixelStretchPathEditorProps {
  points: PixelStretchPathPoint[]
  center: PixelStretchPathPoint
  angle: number
  aspect: number
  onChange: (points: PixelStretchPathPoint[]) => void
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function rotatePoint(point: PixelStretchPathPoint, center: PixelStretchPathPoint, angle: number, aspect: number): PixelStretchPathPoint {
  const radians = angle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const x = (point.x - center.x) * aspect
  const y = point.y - center.y
  return {
    x: center.x + (x * cosine - y * sine) / aspect,
    y: center.y + x * sine + y * cosine,
  }
}

export function PixelStretchPathEditor({ points, center, angle, aspect, onChange }: PixelStretchPathEditorProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [draftPoints, setDraftPoints] = useState(points)
  const draftPointsRef = useRef(points)
  const displayedPoints = draftPoints.map((point) => rotatePoint(point, center, angle, aspect))

  useEffect(() => {
    if (dragging !== null) return
    draftPointsRef.current = points
    setDraftPoints(points)
  }, [dragging, points])

  function beginDrag(index: number, event: ReactPointerEvent): void {
    event.preventDefault()
    event.stopPropagation()
    setDragging(index)
    overlayRef.current?.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragging === null || !overlayRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const rect = overlayRef.current.getBoundingClientRect()
    const displayed = {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    }
    const point = rotatePoint(displayed, center, -angle, aspect)
    const nextPoints = draftPointsRef.current.map((current, index) => index === dragging ? point : current)
    draftPointsRef.current = nextPoints
    setDraftPoints(nextPoints)
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (dragging === null) return
    event.preventDefault()
    event.stopPropagation()
    setDragging(null)
    onChange(draftPointsRef.current)
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) overlayRef.current.releasePointerCapture(event.pointerId)
  }

  const [p0, p1, p2, p3, p4, p5, p6] = displayedPoints
  if (!p0 || !p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null
  const coordinate = (point: PixelStretchPathPoint) => `${point.x * 100} ${point.y * 100}`

  return <div ref={overlayRef} className="pixel-stretch-path-editor" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="pixel-stretch-path-control-line" d={`M ${coordinate(p0)} L ${coordinate(p1)} M ${coordinate(p2)} L ${coordinate(p3)} L ${coordinate(p4)} M ${coordinate(p5)} L ${coordinate(p6)}`} />
      <path className="pixel-stretch-flow-curve" d={`M ${coordinate(p0)} C ${coordinate(p1)}, ${coordinate(p2)}, ${coordinate(p3)} C ${coordinate(p4)}, ${coordinate(p5)}, ${coordinate(p6)}`} />
    </svg>
    {displayedPoints.map((point, index) => <IconButton
      key={index}
      className={`pixel-stretch-path-point ${index === 0 || index === 3 || index === 6 ? 'is-anchor' : 'is-control'}`}
      variant="ghost"
      size="mini"
      icon={<span />}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
      aria-label={index === 0 || index === 3 || index === 6 ? '流线节点' : '流线弯曲控制点'}
      title={index === 0 || index === 3 || index === 6 ? '流线节点' : '流线弯曲控制点'}
      onPointerDown={(event) => beginDrag(index, event)}
    />)}
  </div>
}
