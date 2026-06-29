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
      <button className="workspace-param-value" type="button" onClick={() => onChange(min <= 0 && max >= 0 ? 0 : min)}>
        {formatValue(value)}
      </button>
    </label>
  )
}
import type { CSSProperties } from 'react'
