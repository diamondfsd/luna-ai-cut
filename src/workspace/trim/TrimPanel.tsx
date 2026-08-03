import { Camera, CircleCheck, Images, Pause, Play, Plus, Trash2, Video } from 'lucide-react'
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
  activeMarkerId: string | null
  onActiveMarkerChange: (markerId: string | null) => void
  playingMarkerId: string | null
  onToggleMarkerPreview: (marker: Extract<VideoOutputMarker, { kind: 'video' | 'live' }>) => void
  onMarkerPreviewTimeChange: (time: number) => void
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

function formatCompactSeconds(seconds: number): string {
  const totalCs = Math.max(0, Math.floor(seconds * 100))
  const mins = Math.floor(totalCs / 6000)
  const secs = Math.floor((totalCs % 6000) / 100)
  const cs = totalCs % 100
  return `${mins}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
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
  currentTime: number
  playing: boolean
  onTogglePreview: () => void
  onPreviewTimeChange: (time: number) => void
}

function MarkerRow({ marker, displayLabel, selected, autoFocus, onSelect, onNoteCommit, onDelete, videoPath, onCoverTimeChange, currentTime, playing, onTogglePreview, onPreviewTimeChange }: MarkerRowProps) {
  const [note, setNote] = useState(marker.note || displayLabel)
  const thumbnailVideoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    setNote(marker.note || displayLabel)
  }, [displayLabel, marker.note])

  const liveMarker = marker.kind === 'live' ? marker : null
  const videoMarker = marker.kind === 'video' ? marker : null
  const thumbnailTime = marker.kind === 'photo'
    ? marker.time
    : marker.kind === 'live'
      ? marker.coverTime
      : marker.startTime
  useEffect(() => {
    const video = thumbnailVideoRef.current
    if (!video) return
    const seekThumbnail = () => { video.currentTime = thumbnailTime }
    if (video.readyState >= 1) seekThumbnail()
    else video.addEventListener('loadedmetadata', seekThumbnail, { once: true })
    return () => video.removeEventListener('loadedmetadata', seekThumbnail)
  }, [marker.id, thumbnailTime, videoPath])

  const commitNote = () => {
    const nextNote = note.trim().slice(0, 40)
    setNote(nextNote)
    if (nextNote !== marker.note) onNoteCommit(nextNote)
  }

  return (
    <div
      className={`workspace-trim-marker-row is-media-editor${selected ? ' is-active' : ''}`}
      onClick={onSelect}
    >
      <div className="workspace-trim-marker-thumbnail">
        <video
          ref={thumbnailVideoRef}
          src={filePathToPreviewUrl(videoPath) ?? undefined}
          muted
          playsInline
          preload="metadata"
        />
        {liveMarker || videoMarker ? (
          <button
            type="button"
            className="workspace-trim-live-play-overlay"
            aria-label={playing ? `暂停${markerLabel(marker)}预览` : `播放${markerLabel(marker)}`}
            onClick={(event) => {
              event.stopPropagation()
              onTogglePreview()
            }}
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
        ) : (
          <button
            type="button"
            className="workspace-trim-thumbnail-select"
            aria-label={`选择${markerLabel(marker)}标记`}
            onClick={onSelect}
          />
        )}
      </div>
      <div className="workspace-trim-marker-content">
        <div className="workspace-trim-marker-header">
          <div className={`workspace-trim-marker-title-row is-${marker.kind}`}>
            {markerIcon(marker)}
            <Input
              className="workspace-trim-marker-title"
              variant="compact"
              fullWidth
              type="text"
              value={note}
              maxLength={40}
              aria-label={`${displayLabel}标题`}
              autoFocus={autoFocus}
              onFocus={onSelect}
              onChange={(event) => setNote(event.target.value)}
              onBlur={commitNote}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              }}
            />
            {selected ? <CircleCheck className="workspace-trim-marker-active-icon" size={14} aria-label="当前标记" /> : null}
          </div>
          <Tooltip content={`删除${markerLabel(marker)}标记`}>
            <IconButton
              className="workspace-trim-marker-delete"
              variant="ghost"
              size="mini"
              icon={<Trash2 size={14} />}
              aria-label={`删除${markerLabel(marker)}标记`}
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
            />
          </Tooltip>
        </div>
        {marker.kind === 'photo' ? <span className="workspace-trim-marker-time">{formatSeconds(marker.time)}</span> : null}
        {liveMarker ? (
          <div className="workspace-trim-live-cover-control">
            <span>封面</span>
            <RadixSlider.Root
              className="workspace-trim-live-cover-slider"
              value={[liveMarker.coverTime]}
              min={liveMarker.startTime}
              max={liveMarker.endTime - 0.01}
              step={0.01}
              onPointerDown={onSelect}
              onValueChange={([time]) => {
                const video = thumbnailVideoRef.current
                if (video) video.currentTime = time
                onCoverTimeChange(time)
              }}
            >
              <RadixSlider.Track className="workspace-trim-live-cover-track">
                <RadixSlider.Range className="workspace-trim-live-cover-range" />
              </RadixSlider.Track>
              <RadixSlider.Thumb className="workspace-trim-live-cover-thumb" aria-label="Live 图封面" />
            </RadixSlider.Root>
            <strong>{formatCompactSeconds(liveMarker.startTime)} - {formatCompactSeconds(liveMarker.endTime)}</strong>
          </div>
        ) : null}
        {videoMarker ? (
          <div className="workspace-trim-video-progress-control">
            <span>播放</span>
            <RadixSlider.Root
              className="workspace-trim-video-progress-slider"
              value={[selected
                ? Math.max(videoMarker.startTime, Math.min(currentTime, videoMarker.endTime))
                : videoMarker.startTime]}
              min={videoMarker.startTime}
              max={videoMarker.endTime}
              step={0.01}
              onPointerDown={onSelect}
              onValueChange={([time]) => onPreviewTimeChange(time)}
            >
              <RadixSlider.Track className="workspace-trim-video-progress-track">
                <RadixSlider.Range className="workspace-trim-video-progress-range" />
              </RadixSlider.Track>
              <RadixSlider.Thumb className="workspace-trim-video-progress-thumb" aria-label="视频片段播放位置" />
            </RadixSlider.Root>
            <strong>{formatCompactSeconds(videoMarker.startTime)} - {formatCompactSeconds(videoMarker.endTime)}</strong>
          </div>
        ) : null}
      </div>
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
  activeMarkerId,
  onActiveMarkerChange,
  playingMarkerId,
  onToggleMarkerPreview,
  onMarkerPreviewTimeChange,
}: TrimPanelProps) {
  const [startText, setStartText] = useState(formatSeconds(startTime))
  const [endText, setEndText] = useState(formatSeconds(endTime))
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
    onActiveMarkerChange(marker.id)
    setNewMarkerId(marker.id)
    onMarkersChange(nextMarkers)
    onSelectMarker(marker)
  }

  const addVideo = () => {
    const lastVideoEnd = markers.reduce((latestEnd, marker) => (
      marker.kind === 'video' ? Math.max(latestEnd, marker.endTime) : latestEnd
    ), 0)
    const nextStartTime = lastVideoEnd > 0 ? lastVideoEnd : startTime
    const nextEndTime = endTime > nextStartTime + 0.09 ? endTime : duration
    if (nextEndTime <= nextStartTime + 0.09) {
      toast.show('视频末尾没有可添加的片段')
      return
    }
    addMarker({
      id: crypto.randomUUID(),
      kind: 'video',
      startTime: nextStartTime,
      endTime: nextEndTime,
      note: '',
    })
  }

  const addPhoto = () => {
    const time = Math.min(currentTime, Math.max(0, duration - 0.001))
    const existing = markers.find((marker) => marker.kind === 'photo' && Math.abs(marker.time - time) < 0.01)
    if (existing) {
      onActiveMarkerChange(existing.id)
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
    onSelectMarker(nextMarker)
  }

  const deleteMarker = (id: string) => {
    if (activeMarkerId === id) onActiveMarkerChange(null)
    if (liveSelection?.markerId === id) onLiveSelectionChange(null)
    onMarkersChange(markers.filter((marker) => marker.id !== id))
  }

  const selectMarker = (marker: VideoOutputMarker) => {
    onActiveMarkerChange(marker.id)
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
  const markerIdsByKind = {
    video: markers.filter((marker) => marker.kind === 'video').map((marker) => marker.id),
    photo: markers.filter((marker) => marker.kind === 'photo').map((marker) => marker.id),
    live: markers.filter((marker) => marker.kind === 'live').map((marker) => marker.id),
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
                displayLabel={`${marker.kind === 'live' ? 'Live' : markerLabel(marker)} ${String(markerIdsByKind[marker.kind].indexOf(marker.id) + 1).padStart(2, '0')}`}
                selected={marker.id === activeMarkerId}
                autoFocus={marker.id === newMarkerId}
                onSelect={() => selectMarker(marker)}
                onNoteCommit={(note) => updateMarkerNote(marker.id, note)}
                onDelete={() => deleteMarker(marker.id)}
                videoPath={videoPath}
                onCoverTimeChange={(time) => { if (marker.kind === 'live') setLiveCover(marker, time) }}
                currentTime={currentTime}
                playing={marker.id === playingMarkerId}
                onTogglePreview={() => {
                  if (marker.kind !== 'live' && marker.kind !== 'video') return
                  selectMarker(marker)
                  onToggleMarkerPreview(marker)
                }}
                onPreviewTimeChange={(time) => {
                  selectMarker(marker)
                  onMarkerPreviewTimeChange(time)
                }}
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
