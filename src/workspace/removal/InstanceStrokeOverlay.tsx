import { useRef, type PointerEvent } from 'react'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import type { NormalizedStrokePoint } from './instanceStrokeSelection'
import './InstanceStrokeOverlay.css'

interface InstanceStrokeOverlayProps {
  width: number
  height: number
  displayToSource: (x: number, y: number) => NormalizedStrokePoint
}

export function InstanceStrokeOverlay({ width, height, displayToSource }: InstanceStrokeOverlayProps) {
  const mask = useWorkspaceMask()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourcePointsRef = useRef<NormalizedStrokePoint[]>([])
  const displayPointsRef = useRef<NormalizedStrokePoint[]>([])

  const pointForEvent = (event: PointerEvent<HTMLCanvasElement>): NormalizedStrokePoint => ({
    x: event.nativeEvent.offsetX * width / Math.max(1, event.currentTarget.clientWidth),
    y: event.nativeEvent.offsetY * height / Math.max(1, event.currentTarget.clientHeight),
  })

  const clear = (): void => {
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, width, height)
    sourcePointsRef.current = []
    displayPointsRef.current = []
  }

  const draw = (): void => {
    const context = canvasRef.current?.getContext('2d')
    const points = displayPointsRef.current
    if (!context || points.length === 0) return
    context.clearRect(0, 0, width, height)
    context.save()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 8
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.shadowColor = 'rgba(0, 102, 204, 0.95)'
    context.shadowBlur = 4
    context.beginPath()
    context.moveTo(points[0].x, points[0].y)
    for (const point of points.slice(1)) context.lineTo(point.x, point.y)
    context.stroke()
    context.restore()
  }

  return <canvas
    ref={canvasRef}
    className="workspace-instance-stroke-overlay"
    width={width}
    height={height}
    aria-label="划选要消除的对象"
    onPointerDown={(event) => {
      if (mask.busy) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const displayPoint = pointForEvent(event)
      displayPointsRef.current = [displayPoint]
      sourcePointsRef.current = [displayToSource(displayPoint.x / width, displayPoint.y / height)]
      draw()
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      const displayPoint = pointForEvent(event)
      const previous = displayPointsRef.current[displayPointsRef.current.length - 1]
      if (previous && Math.hypot(displayPoint.x - previous.x, displayPoint.y - previous.y) < 1) return
      displayPointsRef.current.push(displayPoint)
      sourcePointsRef.current.push(displayToSource(displayPoint.x / width, displayPoint.y / height))
      draw()
    }}
    onPointerUp={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      const points = sourcePointsRef.current
      clear()
      if (points.length >= 2) void mask.generateInstanceStrokeMask(points)
    }}
    onPointerCancel={(event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      clear()
    }}
  />
}
