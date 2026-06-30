import { useRef, useState, type CSSProperties, type ReactNode } from 'react'

import type {
  ColorMixChannel,
  SelectiveColorChannel,
  ToneCurveBandAdjust,
  ToneCurveChannel,
} from '../shared/editPipeline'

export const HSL_CHANNELS: Array<{ key: ColorMixChannel; label: string; color: string }> = [
  { key: 'red', label: '红色', color: '#ff3b30' },
  { key: 'orange', label: '橙色', color: '#ff9500' },
  { key: 'yellow', label: '黄色', color: '#ffd60a' },
  { key: 'green', label: '绿色', color: '#34c759' },
  { key: 'aqua', label: '浅绿色', color: '#48d6d2' },
  { key: 'blue', label: '蓝色', color: '#0a84ff' },
  { key: 'purple', label: '紫色', color: '#bf5af2' },
  { key: 'magenta', label: '洋红色', color: '#ff2d9a' },
]

export const SELECTIVE_CHANNELS: Array<{ key: SelectiveColorChannel; label: string; color: string }> = [
  { key: 'red', label: '红色', color: '#ff453a' },
  { key: 'yellow', label: '黄色', color: '#ffd60a' },
  { key: 'green', label: '绿色', color: '#30d158' },
  { key: 'cyan', label: '青色', color: '#64d2ff' },
  { key: 'blue', label: '蓝色', color: '#0a84ff' },
  { key: 'magenta', label: '洋红', color: '#ff2d9a' },
  { key: 'white', label: '白色', color: '#f5f5f7' },
  { key: 'neutral', label: '灰色', color: '#8e8e93' },
  { key: 'black', label: '黑色', color: '#050505' },
]

export const CURVE_CHANNELS: Array<{ key: ToneCurveChannel; label: string }> = [
  { key: 'rgb', label: '全部' },
  { key: 'luminance', label: '亮' },
  { key: 'red', label: '红' },
  { key: 'green', label: '绿' },
  { key: 'blue', label: '蓝' },
]

export function exposureValue(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

export function decimalValue(value: number): string {
  return value.toFixed(1)
}

export function hueColor(hue: number, saturation: number): string {
  return `hsl(${hue} ${Math.max(12, saturation)}% 56%)`
}

function updateWheel(event: React.PointerEvent<HTMLButtonElement>, onChange: (hue: number, saturation: number) => void): void {
  const rect = event.currentTarget.getBoundingClientRect()
  const x = event.clientX - rect.left - rect.width / 2
  const y = event.clientY - rect.top - rect.height / 2
  const radius = Math.max(1, rect.width / 2)
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
  const markerDistance = saturation / 2
  const radians = (hue * Math.PI) / 180
  return (
    <button
      type="button"
      aria-label={label}
      className={`workspace-color-wheel workspace-color-wheel-${size}`}
      onPointerDown={(event) => updateWheel(event, onChange)}
      onPointerMove={(event) => {
        if (event.buttons === 1) updateWheel(event, onChange)
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

function curveY(base: number, adjust: number): number {
  return Math.max(2, Math.min(130, base - adjust * 0.42))
}

export function CurvePreview({ curve, onChange }: { curve: ToneCurveBandAdjust; onChange?: (patch: Partial<ToneCurveBandAdjust>) => void }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<'shadows' | 'darks' | 'lights' | 'highlights' | null>(null)
  const shadowY = curveY(104, curve.shadows)
  const darkY = curveY(82, curve.darks)
  const lightY = curveY(46, curve.lights)
  const highlightY = curveY(12, curve.highlights)
  const curvePath = `M0 130 C30 ${shadowY} 52 ${darkY} 75 66 C105 ${lightY} 135 ${highlightY} 180 2`
  const points: Array<{ id: 'shadows' | 'darks' | 'lights' | 'highlights'; x: number; base: number }> = [
    { id: 'shadows', x: 20, base: 104 },
    { id: 'darks', x: 60, base: 82 },
    { id: 'lights', x: 108, base: 46 },
    { id: 'highlights', x: 158, base: 12 },
  ]
  const pointY: Record<string, number> = { shadows: shadowY, darks: darkY, lights: lightY, highlights: highlightY }

  function handlePointerDown(pointId: typeof dragging, event: React.PointerEvent): void {
    if (!onChange) return
    event.preventDefault()
    setDragging(pointId)
    svgRef.current?.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent): void {
    if (!dragging || !onChange || !svgRef.current) return
    event.preventDefault()
    const rect = svgRef.current.getBoundingClientRect()
    const viewBoxY = Math.max(0, Math.min(132, ((event.clientY - rect.top) / rect.height) * 132))
    const point = points.find((p) => p.id === dragging)
    if (!point) return
    const adjust = Math.max(-100, Math.min(100, Math.round((point.base - viewBoxY) / 0.42)))
    onChange({ [dragging]: adjust })
  }

  function handlePointerUp(): void {
    if (!dragging) return
    setDragging(null)
  }

  return (
    <div className={`workspace-curve-preview${dragging ? ' dragging' : ''}`} aria-hidden="true">
      <svg
        ref={svgRef}
        viewBox="0 0 180 132"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
      >
        <path className="workspace-curve-grid" d="M45 0V132M90 0V132M135 0V132M0 33H180M0 66H180M0 99H180" />
        <path className="workspace-curve-fill" d={`${curvePath} L180 132 L0 132 Z`} />
        <path className="workspace-curve-line" d={curvePath} />
        {onChange && points.map(({ id, x }) => (
          <circle
            key={id}
            cx={x}
            cy={pointY[id]}
            r={6}
            fill="#fff"
            stroke="var(--blue)"
            strokeWidth={1.5}
            style={{ cursor: dragging === id ? 'grabbing' : 'grab' }}
            onPointerDown={(event) => handlePointerDown(id, event)}
          />
        ))}
        <circle cx="75" cy="66" r="3" fill="none" stroke="var(--muted)" strokeWidth={1} opacity={0.5} />
      </svg>
    </div>
  )
}

export function ColorBarSlider({ color, children }: { color: string; children: ReactNode }) {
  return <div className="workspace-color-slider" style={{ '--workspace-slider-color': color } as CSSProperties}>{children}</div>
}
