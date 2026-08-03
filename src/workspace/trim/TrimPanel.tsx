import { Camera, Images, Pause, Play, Plus, Trash2, Video } from 'lucide-react'
import { Slider as RadixSlider } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button, IconButton, Input, Tooltip, toast } from '../../ui'
import { filePathToPreviewUrl } from '../../lib/fileUtils'
import {
  livePhotoRangeAround,
  normalizeVideoOutputMarkers,
  type VideoOutputMarker,
} from './videoOutputMarkers'

import './TrimPanel.css'

interface TrimPanelProps {
  startTime: number
  endTime: number
  currentTime: number
  duration: number
  markers: VideoOutputMarker[]
  onStartTimeChange: (time: number) => void
  onEndTimeChange: (time: number) => void
  onMarkersChange: (markers: VideoOutputMarker[]) => void
  onSelectMarker: (marker: VideoOutputMarker) => void
  liveSelection: LivePhotoSelection | null
  onLiveSelectionChange: (selection: LivePhotoSelection | null) => void
  videoPath: string | null
}

export interface LivePhotoSelection {
  markerId: string
  startTime: number
  endTime: number
  coverTime: number
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000'
  const totalMs = Math.floor(seconds * 1000)
  const mins = Math.floor(totalMs / 60000)
  const secs = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function parseTimeInput(text: string): number {
  const parts = text.trim().split(':')
  if (parts.length < 2) return Number.NaN
  const last = parts.pop()!
  const seconds = Number(last)
  if (!Number.isFinite(seconds)) return Number.NaN
  let total = seconds
  let multiplier = 60
  for (const part of parts.reverse()) {
    const value = Number(part)
    if (!Number.isFinite(value)) return Number.NaN
    total += value * multiplier
    multiplier *= 60
  }
  return total
}

function markerIcon(marker: VideoOutputMarker): React.ReactNode {
  if (marker.kind === 'photo') return <Camera size={15} />
  if (marker.kind === 'live') return <Images size={15} />
  return <Video size={15} />
}

function markerLabel(marker: VideoOutputMarker): string {
  if (marker.kind === 'photo') return '照片'
  if (marker.kind === 'live') return 'Live 图'
  return '视频'
}

interface MarkerRowProps {
  marker: VideoOutputMarker
  displayLabel: string
  selected: boolean
  autoFocus: boolean
  onSelect: () => void
  onNoteCommit: (note: string) => void
  onDelete: () => void
  videoPath: string | null
  onCoverTimeChange: (time: number) => void
}

function MarkerRow({ marker, displayLabel, selected, autoFocus, onSelect, onNoteCommit, onDelete, videoPath, onCoverTimeChange }: MarkerRowProps) {
  const [note, setNote] = useState(marker.note)
  const [livePlaying, setLivePlaying] = useState(false)
  const liveVideoRef = useRef<HTMLVideoElement>(null)
  const livePlaybackStartedRef = useRef(false)
  useEffect(() => setNote(marker.note), [marker.note])

  const liveMarker = marker.kind === 'live' ? marker : null
  useEffect(() => {
    const video = liveVideoRef.current
    if (!video || !liveMarker) return
    const seekCover = () => { video.currentTime = liveMarker.coverTime }
    if (video.readyState >= 1) seekCover()
    else video.addEventListener('loadedmetadata', seekCover, { once: true })
    return () => video.removeEventListener('loadedmetadata', seekCover)
  }, [liveMarker?.coverTime, liveMarker?.id, videoPath])

  const commitNote = () => {
    const nextNote = note.trim().slice(0, 200)
    setNote(nextNote)
    if (nextNote !== marker.note) onNoteCommit(nextNote)
  }

  const toggleLivePlayback = () => {
    const video = liveVideoRef.current
    if (!video || !liveMarker) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (
      !livePlaybackStartedRef.current
      || video.currentTime < liveMarker.startTime
      || video.currentTime >= liveMarker.endTime - 0.01
    ) {
      video.currentTime = liveMarker.startTime
    }
    livePlaybackStartedRef.current = true
    void video.play().catch(() => setLivePlaying(false))
  }

  const markerContent = (
    <>
      <button className="workspace-trim-marker-range" type="button" onClick={onSelect}>
        <span className={`workspace-trim-marker-kind is-${marker.kind}`}>
          {markerIcon(marker)}
          {displayLabel}
        </span>
        <span className="workspace-trim-marker-time">
          {marker.kind === 'photo'
            ? formatSeconds(marker.time)
            : `${formatSeconds(marker.startTime)} - ${formatSeconds(marker.endTime)}`}
        </span>
      </button>
      <div className="workspace-trim-marker-note-row">
        <Input
          className="workspace-trim-marker-note"
          variant="compact"
          fullWidth
          type="text"
          value={note}
          maxLength={200}
          placeholder="添加备注"
          autoFocus={autoFocus}
          onChange={(event) => setNote(event.target.value)}
          onBlur={commitNote}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          }}
        />
        <Tooltip content={`删除${markerLabel(marker)}标记`}>
          <IconButton
            className="workspace-trim-marker-delete"
            variant="ghost"
            size="mini"
            icon={<Trash2 size={14} />}
            aria-label={`删除${markerLabel(marker)}标记`}
            onClick={onDelete}
          />
        </Tooltip>
      </div>
      {liveMarker && selected ? (
        <div className="workspace-trim-live-cover-control">
          <div>
            <span>封面</span>
            <strong>{formatSeconds(liveMarker.coverTime)}</strong>
          </div>
          <RadixSlider.Root
            className="workspace-trim-live-cover-slider"
            value={[liveMarker.coverTime]}
            min={liveMarker.startTime}
            max={liveMarker.endTime - 0.01}
            step={0.01}
            onValueChange={([time]) => {
              const video = liveVideoRef.current
              if (video) {
                video.pause()
                video.currentTime = time
              }
              livePlaybackStartedRef.current = false
              onCoverTimeChange(time)
            }}
          >
            <RadixSlider.Track className="workspace-trim-live-cover-track">
              <RadixSlider.Range className="workspace-trim-live-cover-range" />
            </RadixSlider.Track>
            <RadixSlider.Thumb className="workspace-trim-live-cover-thumb" aria-label="Live 图封面" />
          </RadixSlider.Root>
        </div>
      ) : null}
    </>
  )

  return (
    <div className={`workspace-trim-marker-row${selected ? ' is-selected' : ''}${liveMarker && selected ? ' is-live-editor' : ''}`}>
      {liveMarker && selected ? (
        <div className="workspace-trim-live-thumbnail">
          <video
            ref={liveVideoRef}
            src={filePathToPreviewUrl(videoPath) ?? undefined}
            muted
            playsInline
            preload="metadata"
            onPlay={() => setLivePlaying(true)}
            onPause={() => setLivePlaying(false)}
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime < liveMarker.endTime - 0.01) return
              event.currentTarget.pause()
              event.currentTarget.currentTime = liveMarker.coverTime
              livePlaybackStartedRef.current = false
            }}
          />
          <button
            type="button"
            className="workspace-trim-live-play-overlay"
            aria-label={livePlaying ? '暂停 Live 图预览' : '播放 Live 图'}
            onClick={toggleLivePlayback}
          >
            {livePlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
        </div>
      ) : null}
      <div className="workspace-trim-marker-content">{markerContent}</div>
    </div>
  )
}

export function TrimPanel({
  startTime,
  endTime,
  currentTime,
  duration,
  markers,
  onStartTimeChange,
  onEndTimeChange,
  onMarkersChange,
  onSelectMarker,
  liveSelection,
  onLiveSelectionChange,
  videoPath,
}: TrimPanelProps) {
  const [startText, setStartText] = useState(formatSeconds(startTime))
  const [endText, setEndText] = useState(formatSeconds(endTime))
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [newMarkerId, setNewMarkerId] = useState<string | null>(null)
  const focusedInputRef = useRef<'start' | 'end' | null>(null)

  useEffect(() => {
    if (focusedInputRef.current !== 'start') setStartText(formatSeconds(startTime))
  }, [startTime])
  useEffect(() => {
    if (focusedInputRef.current !== 'end') setEndText(formatSeconds(endTime))
  }, [endTime])

  const commitStart = useCallback(() => {
    focusedInputRef.current = null
    const parsed = parseTimeInput(startText)
    const next = Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, endTime - 0.1)) : startTime
    onStartTimeChange(next)
    setStartText(formatSeconds(next))
  }, [endTime, onStartTimeChange, startText, startTime])

  const commitEnd = useCallback(() => {
    focusedInputRef.current = null
    const parsed = parseTimeInput(endText)
    const next = Number.isFinite(parsed) ? Math.max(startTime + 0.1, Math.min(parsed, duration)) : endTime
    onEndTimeChange(next)
    setEndText(formatSeconds(next))
  }, [duration, endText, endTime, onEndTimeChange, startTime])

  const addMarker = (marker: VideoOutputMarker) => {
    const nextMarkers = normalizeVideoOutputMarkers([...markers, marker], duration)
    setSelectedMarkerId(marker.id)
    setNewMarkerId(marker.id)
    onMarkersChange(nextMarkers)
    onSelectMarker(marker)
  }

  const addVideo = () => {
    if (endTime <= startTime + 0.09) return
    addMarker({ id: crypto.randomUUID(), kind: 'video', startTime, endTime, note: '' })
  }

  const addPhoto = () => {
    const time = Math.min(currentTime, Math.max(0, duration - 0.001))
    const existing = markers.find((marker) => marker.kind === 'photo' && Math.abs(marker.time - time) < 0.01)
    if (existing) {
      setSelectedMarkerId(existing.id)
      onSelectMarker(existing)
      toast.show('当前画面已添加照片标记')
      return
    }
    addMarker({ id: crypto.randomUUID(), kind: 'photo', time, note: '' })
  }

  const beginLiveSelection = () => {
    const range = livePhotoRangeAround(currentTime, duration)
    if (!range) {
      toast.error('视频不足 3 秒，无法添加 Live 图片段')
      return
    }
    const marker = { id: crypto.randomUUID(), kind: 'live' as const, ...range, note: '' }
    addMarker(marker)
    onLiveSelectionChange({ markerId: marker.id, ...range })
  }

  const updateMarkerNote = (id: string, note: string) => {
    onMarkersChange(markers.map((marker) => marker.id === id ? { ...marker, note } : marker))
  }

  const setLiveCover = (marker: Extract<VideoOutputMarker, { kind: 'live' }>, coverTime: number) => {
    const nextCoverTime = Math.max(marker.startTime, Math.min(coverTime, marker.endTime - 0.01))
    const nextMarker = { ...marker, coverTime: nextCoverTime }
    onMarkersChange(markers.map((candidate) => candidate.id === marker.id ? nextMarker : candidate))
    onLiveSelectionChange({
      markerId: nextMarker.id,
      startTime: nextMarker.startTime,
      endTime: nextMarker.endTime,
      coverTime: nextMarker.coverTime,
    })
  }

  const deleteMarker = (id: string) => {
    if (selectedMarkerId === id) setSelectedMarkerId(null)
    if (liveSelection?.markerId === id) onLiveSelectionChange(null)
    onMarkersChange(markers.filter((marker) => marker.id !== id))
  }

  const selectMarker = (marker: VideoOutputMarker) => {
    setSelectedMarkerId(marker.id)
    setNewMarkerId(null)
    onLiveSelectionChange(marker.kind === 'live' ? {
      markerId: marker.id,
      startTime: marker.startTime,
      endTime: marker.endTime,
      coverTime: marker.coverTime,
    } : null)
    onSelectMarker(marker)
  }

  const counts = markers.reduce((result, marker) => ({ ...result, [marker.kind]: result[marker.kind] + 1 }), {
    video: 0,
    photo: 0,
    live: 0,
  })
  const liveMarkerIds = markers.filter((marker) => marker.kind === 'live').map((marker) => marker.id)

  return (
    <div className="workspace-trim-panel">
      <div className="workspace-param-group">
        <div className="workspace-param-row">
          <label className="workspace-param-label">开始时间</label>
          <Input
            className="workspace-trim-time-input"
            variant="compact"
            fullWidth
            value={startText}
            onChange={(event) => setStartText(event.target.value)}
            onFocus={() => { focusedInputRef.current = 'start' }}
            onBlur={commitStart}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          />
        </div>
        <div className="workspace-param-row">
          <label className="workspace-param-label">结束时间</label>
          <Input
            className="workspace-trim-time-input"
            variant="compact"
            fullWidth
            value={endText}
            onChange={(event) => setEndText(event.target.value)}
            onFocus={() => { focusedInputRef.current = 'end' }}
            onBlur={commitEnd}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
          />
        </div>
        <div className="workspace-param-row">
          <label className="workspace-param-label">截取后时长</label>
          <span className="workspace-trim-duration-display">{formatSeconds(Math.max(0, endTime - startTime))}</span>
        </div>
      </div>

      <section className="workspace-trim-markers" aria-label="导出标记">
        <div className="workspace-trim-markers-header">
          <h3>导出标记</h3>
          <span>{counts.video} 段 / {counts.photo} 张 / {counts.live} 个 Live</span>
        </div>
        <div className="workspace-trim-marker-actions">
          <Button variant="secondary" size="mini" icon={<Video size={14} />} onClick={addVideo}>视频片段</Button>
          <Button variant="secondary" size="mini" icon={<Camera size={14} />} onClick={addPhoto}>照片</Button>
          <Button
            variant={liveSelection ? 'primary' : 'secondary'}
            size="mini"
            icon={<Images size={14} />}
            disabled={duration < 3}
            onClick={beginLiveSelection}
          >
            Live 图
          </Button>
        </div>

        {markers.length > 0 ? (
          <div className="workspace-trim-marker-list">
            {markers.map((marker) => (
              <MarkerRow
                key={marker.id}
                marker={marker}
                displayLabel={marker.kind === 'live'
                  ? `Live ${String(liveMarkerIds.indexOf(marker.id) + 1).padStart(2, '0')}`
                  : markerLabel(marker)}
                selected={marker.id === selectedMarkerId || marker.id === liveSelection?.markerId}
                autoFocus={marker.id === newMarkerId}
                onSelect={() => selectMarker(marker)}
                onNoteCommit={(note) => updateMarkerNote(marker.id, note)}
                onDelete={() => deleteMarker(marker.id)}
                videoPath={videoPath}
                onCoverTimeChange={(time) => { if (marker.kind === 'live') setLiveCover(marker, time) }}
              />
            ))}
          </div>
        ) : (
          <p className="workspace-trim-markers-empty"><Plus size={14} />在当前画面添加照片，或保存视频与 Live 图片段</p>
        )}
      </section>
    </div>
  )
}
