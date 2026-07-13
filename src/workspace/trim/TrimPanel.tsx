import { useCallback, useEffect, useRef, useState } from 'react'

import { Input } from '../../ui'

import './TrimPanel.css'

interface TrimPanelProps {
  startTime: number
  endTime: number
  duration: number
  onStartTimeChange: (time: number) => void
  onEndTimeChange: (time: number) => void
}

/** 秒 → mm:ss.SSS */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000'
  const totalMs = Math.floor(seconds * 1000)
  const mins = Math.floor(totalMs / 60000)
  const secs = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

/** mm:ss.SSS 或 hh:mm:ss.SSS → 秒 */
function parseTimeInput(text: string): number {
  const trimmed = text.trim()
  const parts = trimmed.split(':')
  if (parts.length < 2) return NaN
  const last = parts.pop()!
  const msIndex = last.indexOf('.')
  let secs: number
  let ms: number
  if (msIndex >= 0) {
    secs = parseInt(last.slice(0, msIndex), 10)
    ms = parseInt(last.slice(msIndex + 1).padEnd(3, '0').slice(0, 3), 10)
  } else {
    secs = parseInt(last, 10)
    ms = 0
  }
  if (isNaN(secs)) return NaN
  const totalMs = ms + secs * 1000
  let multiplier = 60000
  let total = totalMs
  for (const part of parts.reverse()) {
    const val = parseInt(part, 10)
    if (isNaN(val)) return NaN
    total += val * multiplier
    multiplier *= 60
  }
  return total / 1000
}

export function TrimPanel({
  startTime,
  endTime,
  duration,
  onStartTimeChange,
  onEndTimeChange,
}: TrimPanelProps) {
  const [startText, setStartText] = useState(formatSeconds(startTime))
  const [endText, setEndText] = useState(formatSeconds(endTime))
  const isFocusedRef = useRef(false)

  // Sync display text when props change externally (e.g. trim strip dragging)
  useEffect(() => {
    if (!isFocusedRef.current) {
      setStartText(formatSeconds(startTime))
    }
  }, [startTime])

  useEffect(() => {
    if (!isFocusedRef.current) {
      setEndText(formatSeconds(endTime))
    }
  }, [endTime])

  const handleStartBlur = useCallback(() => {
    isFocusedRef.current = false
    const parsed = parseTimeInput(startText)
    const clamped = Math.max(0, Math.min(parsed, endTime - 0.1))
    if (Number.isFinite(clamped)) {
      onStartTimeChange(clamped)
      setStartText(formatSeconds(clamped))
    } else {
      setStartText(formatSeconds(startTime))
    }
  }, [startText, endTime, onStartTimeChange, startTime])

  const handleEndBlur = useCallback(() => {
    isFocusedRef.current = false
    const parsed = parseTimeInput(endText)
    const clamped = Math.max(startTime + 0.1, Math.min(parsed, duration))
    if (Number.isFinite(clamped)) {
      onEndTimeChange(clamped)
      setEndText(formatSeconds(clamped))
    } else {
      setEndText(formatSeconds(endTime))
    }
  }, [endText, startTime, duration, onEndTimeChange, endTime])

  const trimDuration = Math.max(0, endTime - startTime)

  return (
    <div className="workspace-trim-panel">
      <div className="workspace-param-group">
        <div className="workspace-param-row">
          <label className="workspace-param-label">开始时间</label>
          <Input
            className="workspace-trim-time-input"
            variant="compact"
            fullWidth
            type="text"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            onBlur={handleStartBlur}
            onFocus={() => { isFocusedRef.current = true }}
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
          />
        </div>
        <div className="workspace-param-row">
          <label className="workspace-param-label">结束时间</label>
          <Input
            className="workspace-trim-time-input"
            variant="compact"
            fullWidth
            type="text"
            value={endText}
            onChange={(e) => setEndText(e.target.value)}
            onBlur={handleEndBlur}
            onFocus={() => { isFocusedRef.current = true }}
            onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
          />
        </div>
        <div className="workspace-param-row">
          <label className="workspace-param-label">截取后时长</label>
          <span className="workspace-trim-duration-display">{formatSeconds(trimDuration)}</span>
        </div>
      </div>
    </div>
  )
}
