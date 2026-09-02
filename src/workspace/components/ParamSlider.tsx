import { useState, useEffect, useRef, type ReactNode } from 'react'
import { Slider as RadixSlider } from 'radix-ui'
import { logger } from '../../lib/rendererLogger'

interface ParamSliderProps {
  label: ReactNode
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  onPreviewChange?: (value: number) => void
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
  onPreviewChange,
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
  const draggingRef = useRef(false)
  const pointerSessionRef = useRef(false)
  const pointerStartValueRef = useRef(value)
  const latestSliderValueRef = useRef(value)
  const skipNextCommitRef = useRef<number | null>(null)
  const sliderEventSequenceRef = useRef(0)
  const commitMode = onCommit !== undefined
  const diagnosticLabel = typeof label === 'string' ? label : 'parameter'
  const displayValue = numericInputValue(value, formatValue)
  const sliderDisplayValue = numericInputValue(commitMode ? sliderValue : value, formatValue)
  const renderedValue = commitMode ? sliderValue : value
  const renderedValueRatio = max - min > 0 ? (renderedValue - min) / (max - min) : 0.5
  const renderedFillLeft = Math.min(zeroRatio, renderedValueRatio) * 100
  const renderedFillWidth = Math.abs(renderedValueRatio - zeroRatio) * 100

  useEffect(() => {
    if (!editing) {
      setEditValue(displayValue)
    }
  }, [displayValue, editing])

  useEffect(() => {
    if (commitMode && !draggingRef.current) {
      setSliderValue(value)
      latestSliderValueRef.current = value
    }
  }, [commitMode, value])

  function commit() {
    const parsed = Number(editValue)
    if (!Number.isFinite(parsed)) {
      setEditValue(formatValue(value))
    } else {
      const next = Math.min(max, Math.max(min, parsed))
      if (onCommit) {
        setSliderValue(next)
        latestSliderValueRef.current = next
      }
      const commitChange = onCommit ?? onChange
      commitChange(next)
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
      if (pending !== null) {
        const previewChange = onPreviewChange ?? (onCommit ? null : onChange)
        previewChange?.(pending)
      }
    })
  }

  function flushSliderChange(next: number): void {
    const pointerCommit = pointerSessionRef.current || draggingRef.current
    const committedValue = pointerCommit ? latestSliderValueRef.current : next
    logger.info('[PreviewDebug] workspace slider commit event', {
      label: diagnosticLabel,
      sequence: ++sliderEventSequenceRef.current,
      eventValue: next,
      committedValue,
      pointerCommit,
      pointerSession: pointerSessionRef.current,
      dragging: draggingRef.current,
    })
    if (!Number.isFinite(committedValue)) return
    if (skipNextCommitRef.current === committedValue) {
      skipNextCommitRef.current = null
      pointerSessionRef.current = false
      draggingRef.current = false
      return
    }
    if (pointerCommit && committedValue === pointerStartValueRef.current) {
      pointerSessionRef.current = false
      draggingRef.current = false
      return
    }
    pendingValueRef.current = null
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setSliderValue(committedValue)
    latestSliderValueRef.current = committedValue
    if (pointerCommit) skipNextCommitRef.current = committedValue
    pointerSessionRef.current = false
    draggingRef.current = false
    const commitChange = onCommit ?? onChange
    commitChange(committedValue)
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
          value={[commitMode ? sliderValue : value]}
          min={min}
          max={max}
          step={step}
          onPointerDown={() => {
            pointerSessionRef.current = true
            pointerStartValueRef.current = latestSliderValueRef.current
            skipNextCommitRef.current = null
            draggingRef.current = true
            logger.info('[PreviewDebug] workspace slider pointer down', {
              label: diagnosticLabel,
              sequence: ++sliderEventSequenceRef.current,
              value: latestSliderValueRef.current,
            })
          }}
          onValueChange={([v]) => {
            latestSliderValueRef.current = v
            if (onCommit) setSliderValue(v)
            if (!onCommit || onPreviewChange) scheduleSliderChange(v)
            logger.info('[PreviewDebug] workspace slider value change', {
              label: diagnosticLabel,
              sequence: ++sliderEventSequenceRef.current,
              value: v,
              pointerSession: pointerSessionRef.current,
              dragging: draggingRef.current,
            })
          }}
          onValueCommit={([v]) => flushSliderChange(v)}
          onPointerUp={() => flushSliderChange(latestSliderValueRef.current)}
          onPointerCancel={() => flushSliderChange(latestSliderValueRef.current)}
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
