import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, IconButton, Input, Tooltip } from '../../ui'
import type { VideoSegmentMarker } from './videoSegmentMarkers'

import './TrimPanel.css'

interface TrimPanelProps {
  startTime: number
  endTime: number
  duration: number
  markers: VideoSegmentMarker[]
  onStartTimeChange: (time: number) => void
  onEndTimeChange: (time: number) => void
  onMarkersChange: (markers: VideoSegmentMarker[]) => void
  onSelectMarker: (marker: VideoSegmentMarker) => void
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

interface MarkerRowProps {
  marker: VideoSegmentMarker
  autoFocus: boolean
  onSelect: () => void
  onNoteCommit: (note: string) => void
  onDelete: () => void
}

function MarkerRow({ marker, autoFocus, onSelect, onNoteCommit, onDelete }: MarkerRowProps) {
  const [note, setNote] = useState(marker.note)

  useEffect(() => setNote(marker.note), [marker.note])

  const commitNote = () => {
    const nextNote = note.trim().slice(0, 200)
    setNote(nextNote)
    if (nextNote !== marker.note) onNoteCommit(nextNote)
  }

  return (
    <div className="workspace-trim-marker-row">
      <button className="workspace-trim-marker-range" type="button" onClick={onSelect}>
        <span>{formatSeconds(marker.startTime)}</span>
        <span className="workspace-trim-marker-separator">至</span>
        <span>{formatSeconds(marker.endTime)}</span>
      </button>
      <div className="workspace-trim-marker-note-row">
        <Input
          className="workspace-trim-marker-note"
          variant="compact"
          fullWidth
          type="text"
          value={note}
          maxLength={200}
          placeholder="填写剪辑备注"
          autoFocus={autoFocus}
          onChange={(event) => setNote(event.target.value)}
          onBlur={commitNote}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
        <Tooltip content="删除片段标记">
          <IconButton
            className="workspace-trim-marker-delete"
            variant="ghost"
            size="mini"
            icon={<Trash2 size={14} />}
            aria-label="删除片段标记"
            onClick={onDelete}
          />
        </Tooltip>
      </div>
    </div>
  )
}

export function TrimPanel({
  startTime,
  endTime,
  duration,
  markers,
  onStartTimeChange,
  onEndTimeChange,
  onMarkersChange,
  onSelectMarker,
}: TrimPanelProps) {
  const [startText, setStartText] = useState(formatSeconds(startTime))
  const [endText, setEndText] = useState(formatSeconds(endTime))
  const [newMarkerId, setNewMarkerId] = useState<string | null>(null)
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

  const addCurrentRange = () => {
    if (endTime <= startTime) return
    const marker: VideoSegmentMarker = {
      id: crypto.randomUUID(),
      startTime,
      endTime,
      note: '',
    }
    setNewMarkerId(marker.id)
    onMarkersChange([...markers, marker])
  }

  const updateMarkerNote = (id: string, note: string) => {
    onMarkersChange(markers.map((marker) => marker.id === id ? { ...marker, note } : marker))
  }

  const deleteMarker = (id: string) => {
    onMarkersChange(markers.filter((marker) => marker.id !== id))
  }

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
      <section className="workspace-trim-markers" aria-label="片段标记">
        <div className="workspace-trim-markers-header">
          <div>
            <h3>片段标记</h3>
            <span>{markers.length} 段</span>
          </div>
          <Button
            variant="secondary"
            size="mini"
            icon={<Plus size={14} />}
            disabled={endTime <= startTime}
            onClick={addCurrentRange}
          >
            添加当前片段
          </Button>
        </div>
        {markers.length > 0 ? (
          <div className="workspace-trim-marker-list">
            {markers.map((marker) => (
              <MarkerRow
                key={marker.id}
                marker={marker}
                autoFocus={marker.id === newMarkerId}
                onSelect={() => onSelectMarker(marker)}
                onNoteCommit={(note) => updateMarkerNote(marker.id, note)}
                onDelete={() => deleteMarker(marker.id)}
              />
            ))}
          </div>
        ) : (
          <p className="workspace-trim-markers-empty">调整截取范围后，添加为可备注的片段标记。</p>
        )}
      </section>
    </div>
  )
}
