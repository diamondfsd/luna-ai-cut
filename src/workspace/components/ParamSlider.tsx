import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Slider as RadixSlider } from 'radix-ui'

interface ParamSliderProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onCommit?: (value: number) => void
  formatValue?: (value: number) => string
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

function numericInputValue(value: number, formatValue: (value: number) => string): string {
  const formatted = formatValue(value).replace(/^\+/, '')
  return Number.isFinite(Number(formatted)) ? formatted : String(value)
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  formatValue = formatSigned,
}: ParamSliderProps) {
  const accessibleLabel = typeof label === 'string' ? label : '参数'
  const zeroRatio = max - min > 0 ? (0 - min) / (max - min) : 0.5

  const [editValue, setEditValue] = useState(() => formatValue(value))
  const [editing, setEditing] = useState(false)
  const [sliderValue, setSliderValue] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)
  const rafRef = useRef<number | null>(null)
  const pendingValueRef = useRef<number | null>(null)
  const displayValue = numericInputValue(value, formatValue)
  const sliderDisplayValue = numericInputValue(onCommit ? sliderValue : value, formatValue)
  const renderedValue = onCommit ? sliderValue : value
  const renderedValueRatio = max - min > 0 ? (renderedValue - min) / (max - min) : 0.5
  const renderedFillLeft = Math.min(zeroRatio, renderedValueRatio) * 100
  const renderedFillWidth = Math.abs(renderedValueRatio - zeroRatio) * 100

  useEffect(() => {
    if (!editing) {
      setEditValue(displayValue)
    }
    if (onCommit) setSliderValue(value)
  }, [displayValue, editing, onCommit, value])

  function commit() {
    const parsed = Number(editValue)
    if (!Number.isFinite(parsed)) {
      setEditValue(formatValue(value))
    } else {
      const next = Math.min(max, Math.max(min, parsed))
      if (onCommit) setSliderValue(next)
      ;(onCommit ?? onChange)(next)
    }
    setEditing(false)
  }

  function scheduleSliderChange(next: number): void {
    pendingValueRef.current = next
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const pending = pendingValueRef.current
      pendingValueRef.current = null
      if (pending !== null) onChange(pending)
    })
  }

  function flushSliderChange(next: number): void {
    pendingValueRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setSliderValue(next)
    const commitChange = onCommit ?? onChange
    commitChange(next)
  }

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="workspace-param-slider">
      <div className="workspace-param-header">
        <span className="workspace-param-label">{label}</span>
        <input
          ref={inputRef}
          type="number"
          aria-label={`${accessibleLabel}数值`}
          className="workspace-param-value-input"
          min={min}
          max={max}
          step={step}
          value={editing ? editValue : onCommit ? sliderDisplayValue : displayValue}
          onChange={(e) => { setEditing(true); setEditValue(e.currentTarget.value) }}
          onFocus={() => { setEditValue(displayValue); setEditing(true) }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur() } }}
        />
      </div>
      <div className="workspace-range-wrap">
        <RadixSlider.Root
          className="workspace-slider-root"
          value={[onCommit ? sliderValue : value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => { if (onCommit) setSliderValue(v); scheduleSliderChange(v) }}
          onValueCommit={([v]) => flushSliderChange(v)}
        >
          <RadixSlider.Track className="workspace-slider-track">
            <div
              className="workspace-slider-fill"
              style={{ left: `${renderedFillLeft}%`, width: `${renderedFillWidth}%` }}
            />
            <div
              className="workspace-slider-zero"
              style={{ left: `${zeroRatio * 100}%` }}
            />
          </RadixSlider.Track>
          <RadixSlider.Thumb
            className="workspace-slider-thumb"
            aria-label={`${accessibleLabel}滑块`}
            onDoubleClick={() => onChange(min <= 0 && max >= 0 ? 0 : min)}
          />
        </RadixSlider.Root>
      </div>
    </div>
  )
}
