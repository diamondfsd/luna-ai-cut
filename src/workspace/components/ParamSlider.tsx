import { useState, useEffect, useRef } from 'react'
import { Slider as RadixSlider } from 'radix-ui'

interface ParamSliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  formatValue?: (value: number) => string
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

export function ParamSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue = formatSigned,
}: ParamSliderProps) {
  const zeroRatio = max - min > 0 ? (0 - min) / (max - min) : 0.5
  const valueRatio = max - min > 0 ? (value - min) / (max - min) : 0.5
  const fillLeft = Math.min(zeroRatio, valueRatio) * 100
  const fillWidth = Math.abs(valueRatio - zeroRatio) * 100

  const [editValue, setEditValue] = useState(() => formatValue(value))
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) {
      setEditValue(formatValue(value))
    }
  }, [value, editing, formatValue])

  function commit() {
    const parsed = Number(editValue)
    if (!Number.isFinite(parsed)) {
      setEditValue(formatValue(value))
    } else {
      onChange(Math.min(max, Math.max(min, parsed)))
    }
    setEditing(false)
  }

  return (
    <div className="workspace-param-slider">
      <div className="workspace-param-header">
        <span className="workspace-param-label">{label}</span>
        <input
          ref={inputRef}
          type="number"
          className="workspace-param-value-input"
          min={min}
          max={max}
          step={step}
          value={editing ? editValue : String(value)}
          onChange={(e) => { setEditing(true); setEditValue(e.currentTarget.value) }}
          onFocus={() => { setEditValue(String(value)); setEditing(true) }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur() } }}
        />
      </div>
      <div className="workspace-range-wrap">
        <RadixSlider.Root
          className="workspace-slider-root"
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={([v]) => onChange(v)}
        >
          <RadixSlider.Track className="workspace-slider-track">
            <div
              className="workspace-slider-fill"
              style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
            />
            <div
              className="workspace-slider-zero"
              style={{ left: `${zeroRatio * 100}%` }}
            />
          </RadixSlider.Track>
          <RadixSlider.Thumb
            className="workspace-slider-thumb"
            onDoubleClick={() => onChange(min <= 0 && max >= 0 ? 0 : min)}
          />
        </RadixSlider.Root>
      </div>
    </div>
  )
}
