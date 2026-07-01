import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type { CurvePoint, ToneCurveChannel } from '../shared/editPipeline'

export const HSL_CHANNELS: Array<{ key: string; label: string; hue: number; color: string }> = [
  { key: 'red', label: '红色', hue: 0, color: '#ff3b30' },
  { key: 'orange', label: '橙色', hue: 30, color: '#ff9500' },
  { key: 'yellow', label: '黄色', hue: 60, color: '#ffd60a' },
  { key: 'green', label: '绿色', hue: 120, color: '#34c759' },
  { key: 'aqua', label: '浅绿色', hue: 170, color: '#48d6d2' },
  { key: 'blue', label: '蓝色', hue: 220, color: '#0a84ff' },
  { key: 'purple', label: '紫色', hue: 275, color: '#bf5af2' },
  { key: 'magenta', label: '洋红色', hue: 320, color: '#ff2d9a' },
]

export const CURVE_CHANNELS: Array<{ key: ToneCurveChannel; label: string }> = [
  { key: 'rgb', label: '全部' },
  { key: 'luminance', label: '亮度' },
  { key: 'red', label: '红' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
]

export function exposureValue(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)} EV`
}

export function hueColor(hue: number, saturation: number): string {
  return `hsl(${hue} ${saturation}% 56%)`
}

function updateWheel(event: React.PointerEvent<HTMLButtonElement>, onChange: (hue: number, saturation: number) => void): void {
  const rect = event.currentTarget.getBoundingClientRect()
  const radius = Math.max(1, Math.min(rect.width, rect.height) / 2)
  const x = event.clientX - rect.left - rect.width / 2
  const y = event.clientY - rect.top - rect.height / 2
  const hue = Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360)
  const saturation = Math.round(Math.min(100, Math.hypot(x, y) / radius * 100))
  onChange(hue, saturation)
}

export function ColorWheel({
  label,
  hue,
  saturation,
  size = 'default',
  onChange,
}: {
  label: string
  hue: number
  saturation: number
  size?: 'default' | 'mini'
  onChange: (hue: number, saturation: number) => void
}) {
  const wheelSize = size === 'mini' ? 76 : 150
  const markerDistance = (saturation / 100) * (wheelSize / 2)
  const radians = (hue * Math.PI) / 180
  return (
    <button
      type="button"
      aria-label={label}
      className={`workspace-color-wheel workspace-color-wheel-${size}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        updateWheel(event, onChange)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateWheel(event, onChange)
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      <span
        className="workspace-color-wheel-marker"
        style={{
          transform: `translate(${Math.cos(radians) * markerDistance}px, ${Math.sin(radians) * markerDistance}px)`,
        }}
      />
    </button>
  )
}

function pointToSvg(point: CurvePoint): { x: number; y: number } {
  return { x: point.x * 180, y: (1 - point.y) * 132 }
}

function eventToPoint(event: React.PointerEvent<SVGSVGElement>): CurvePoint {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)),
  }
}

function curvePath(points: CurvePoint[]): string {
  const ordered = [{ x: 0, y: 0 }, ...points, { x: 1, y: 1 }].sort((a, b) => a.x - b.x)
  return ordered.map((point, index) => {
    const svg = pointToSvg(point)
    return `${index === 0 ? 'M' : 'L'}${svg.x.toFixed(1)} ${svg.y.toFixed(1)}`
  }).join(' ')
}

export function CurvePreview({
  points,
  onChange,
}: {
  points: CurvePoint[]
  onChange: (points: CurvePoint[]) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const path = curvePath(points)

  function commit(nextPoints: CurvePoint[]): void {
    onChange(nextPoints.sort((a, b) => a.x - b.x).slice(0, 12))
  }

  function addPoint(event: React.PointerEvent<SVGSVGElement>): void {
    if (event.target !== event.currentTarget && !(event.target as SVGElement).classList.contains('workspace-curve-hit')) return
    if (points.length >= 12) return
    const point = eventToPoint(event)
    const next = [...points, point].sort((a, b) => a.x - b.x)
    const index = next.findIndex((item) => item === point)
    commit(next)
    setDragging(index)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function movePoint(event: React.PointerEvent<SVGSVGElement>): void {
    if (dragging === null) return
    const point = eventToPoint(event)
    const next = points.map((item, index) => index === dragging ? point : item)
    commit(next)
  }

  function stopDrag(event: React.PointerEvent<SVGSVGElement>): void {
    if (dragging === null) return
    setDragging(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function removePoint(index: number): void {
    commit(points.filter((_, pointIndex) => pointIndex !== index))
  }

  return (
    <div className={`workspace-curve-preview${dragging !== null ? ' dragging' : ''}`}>
      <svg
        ref={svgRef}
        viewBox="0 0 180 132"
        onPointerDown={addPoint}
        onPointerMove={movePoint}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onContextMenu={(event) => event.preventDefault()}
        style={{ touchAction: 'none' }}
      >
        <rect className="workspace-curve-hit" x="0" y="0" width="180" height="132" fill="transparent" />
        <path className="workspace-curve-grid" d="M45 0V132M90 0V132M135 0V132M0 33H180M0 66H180M0 99H180" />
        <path className="workspace-curve-line muted" d="M0 132L180 0" />
        <path className="workspace-curve-line" d={path} />
        {points.map((point, index) => {
          const svg = pointToSvg(point)
          return (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={svg.x}
              cy={svg.y}
              r={6}
              fill="#fff"
              stroke="var(--blue)"
              strokeWidth={1.5}
              style={{ cursor: dragging === index ? 'grabbing' : 'grab' }}
              onPointerDown={(event) => {
                event.stopPropagation()
                setDragging(index)
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId)
              }}
              onDoubleClick={(event) => {
                event.stopPropagation()
                removePoint(index)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                removePoint(index)
              }}
            />
          )
        })}
      </svg>
    </div>
  )
}

export function ColorBarSlider({ color, children }: { color: string; children: ReactNode }) {
  return <div className="workspace-color-slider" style={{ '--workspace-slider-color': color } as CSSProperties}>{children}</div>
}
