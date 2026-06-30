import { useState, useEffect, useRef, type CSSProperties } from 'react'

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
  const zeroPosition = `${((-min) / (max - min)) * 100}%`
  const valuePosition = `${((value - min) / (max - min)) * 100}%`

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
    <label className="workspace-param-slider">
      <span className="workspace-param-label">{label}</span>
      <span className="workspace-range-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onDoubleClick={() => onChange(min <= 0 && max >= 0 ? 0 : min)}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          style={{
            '--workspace-range-zero': zeroPosition,
            '--workspace-range-value': valuePosition,
          } as CSSProperties}
        />
      </span>
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
    </label>
  )
}
