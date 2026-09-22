import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronsUpDown, Minus, Plus } from 'lucide-react'

import '../styles/live-zoom-joystick.css'

interface LiveZoomJoystickProps {
  value: number
  min: number
  max: number
  disabled?: boolean
  onPreview: (value: number) => void
  onCommit: (value: number) => void
}

const HEIGHT = 124
const TRACK_INSET = 20
const DEAD_ZONE = 0.08
const FULL_RANGE_SECONDS = 3
const COMMAND_INTERVAL_MS = 50

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatZoom(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}x`
}

export function LiveZoomJoystick({ value, min, max, disabled, onPreview, onCommit }: LiveZoomJoystickProps) {
  const joystickRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)
  const rateRef = useRef(0)
  const valueRef = useRef(clamp(value, min, max))
  const lastTickRef = useRef(0)
  const [displayValue, setDisplayValue] = useState(valueRef.current)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (dragging) return
    valueRef.current = clamp(value, min, max)
    setDisplayValue(valueRef.current)
  }, [dragging, max, min, value])

  useEffect(() => () => {
    if (timerRef.current != null) window.clearInterval(timerRef.current)
  }, [])

  const updateRate = (clientY: number) => {
    const rect = joystickRef.current?.getBoundingClientRect()
    if (!rect) return
    const trackTop = rect.top + TRACK_INSET
    const trackBottom = rect.bottom - TRACK_INSET
    const center = (trackTop + trackBottom) / 2
    const travel = (trackBottom - trackTop) / 2
    const rawRate = clamp((center - clientY) / travel, -1, 1)
    const magnitude = Math.abs(rawRate)
    const adjusted = magnitude <= DEAD_ZONE
      ? 0
      : (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE)
    rateRef.current = Math.sign(rawRate) * adjusted
  }

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || max <= min) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    lastTickRef.current = performance.now()
    updateRate(event.clientY)
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      const now = performance.now()
      const elapsed = Math.min(200, now - lastTickRef.current)
      lastTickRef.current = now
      if (rateRef.current === 0) return
      const next = clamp(
        valueRef.current + ((max - min) / FULL_RANGE_SECONDS) * (elapsed / 1_000) * rateRef.current,
        min,
        max,
      )
      if (Math.abs(next - valueRef.current) < 0.0001) return
      valueRef.current = next
      setDisplayValue(next)
      onPreview(next)
    }, COMMAND_INTERVAL_MS)
  }

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    updateRate(event.clientY)
  }

  const stop = () => {
    if (!dragging) return
    if (timerRef.current != null) window.clearInterval(timerRef.current)
    timerRef.current = null
    rateRef.current = 0
    setDragging(false)
    onCommit(valueRef.current)
  }

  const trackHeight = HEIGHT - TRACK_INSET * 2
  const knobTop = HEIGHT / 2 - 14 - rateRef.current * (trackHeight - 28) / 2

  return (
    <div className="live-zoom-joystick-wrap">
      <div
        ref={joystickRef}
        className="live-zoom-joystick"
        data-active={dragging ? 'true' : 'false'}
        data-disabled={disabled ? 'true' : 'false'}
        role="slider"
        aria-label="焦段"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={displayValue}
        aria-valuetext={formatZoom(displayValue)}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <Plus size={14} aria-hidden="true" />
        <span className="live-zoom-joystick-track" />
        <span className="live-zoom-joystick-center" />
        <span className="live-zoom-joystick-knob" style={{ top: knobTop }}>
          <ChevronsUpDown size={15} />
        </span>
        <Minus size={14} aria-hidden="true" />
      </div>
      <output>{formatZoom(displayValue)}</output>
    </div>
  )
}
