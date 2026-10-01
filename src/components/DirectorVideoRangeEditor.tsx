import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import type { DirectorLanShot, DirectorLanTake } from '../shared/types'
import type { DirectorTakeRange } from '../lib/directorTakeRange'
import { Button, Dialog, Input, LoadingIndicator, toast } from '../ui'
import { DirectorShotInspector } from './DirectorShotInspector'
import { PreviewStage, type PreviewStageHandle } from './PreviewStage'
import { TrimStrip } from '../workspace/trim/TrimStrip'
import { useTrimThumbnails } from '../workspace/trim/useTrimThumbnails'
import './DirectorVideoRangeEditor.css'
import './DirectorShotDetailDialog.css'

interface Props {
  take: DirectorLanTake
  shot: DirectorLanShot
  takes: DirectorLanTake[]
  source: () => Promise<string>
  onSave: (range: DirectorTakeRange) => Promise<void>
  onSelectTake: (take: DirectorLanTake) => void
  onClose: () => void
  adding: boolean
  onAddMaterials: () => void
  phoneConnected: boolean
  onDeleteMaterial: (take: DirectorLanTake) => Promise<void>
}

export function DirectorVideoRangeEditor({ take, shot, takes, source, onSave, onSelectTake, onClose, adding, onAddMaterials, phoneConnected, onDeleteMaterial }: Props) {
  const playable = take.available && Boolean(take.stream_url)
  const isVideo = take.kind === 'video' && playable
  const stage = useRef<PreviewStageHandle>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [media, setMedia] = useState({ currentTime: 0, duration: 0, playing: false })
  const [range, setRange] = useState({ start: take.selected_range?.start_ms ?? 0, end: take.selected_range?.end_ms ?? 0 })
  const [note, setNote] = useState(take.selected_range?.note ?? '')
  const [marked, setMarked] = useState(Boolean(take.selected_range))
  const [saving, setSaving] = useState(false)
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null)
  const initialized = useRef(false)
  const sourceLoader = useRef(source)
  sourceLoader.current = source
  const takeSnapshot = useRef(take)
  takeSnapshot.current = take
  const rangePlayback = useRef(false)
  const desiredSeek = useRef<number | null>(null)
  const endPreview = useRef<number | null>(null)
  const seekFrame = useRef<number | null>(null)
  const currentRange = useRef(range)
  currentRange.current = range
  const baseline = useRef(JSON.stringify(take.selected_range))
  const selected: DirectorTakeRange = marked ? { start_ms: Math.round(range.start), end_ms: Math.round(range.end), ...(note.trim() ? { note: note.trim() } : {}) } : null
  const dirty = JSON.stringify(selected) !== baseline.current
  const { thumbnails } = useTrimThumbnails({ videoPath: url, duration: media.duration })

  useEffect(() => {
    let cancelled = false
    const nextTake = takeSnapshot.current
    setUrl(null)
    setError(null)
    setMedia({ currentTime: 0, duration: 0, playing: false })
    setRange({ start: nextTake.selected_range?.start_ms ?? 0, end: nextTake.selected_range?.end_ms ?? 0 })
    setNote(nextTake.selected_range?.note ?? '')
    setMarked(nextTake.kind === 'video' && Boolean(nextTake.selected_range))
    baseline.current = JSON.stringify(nextTake.selected_range)
    initialized.current = false
    rangePlayback.current = false
    if (seekFrame.current !== null) { cancelAnimationFrame(seekFrame.current); seekFrame.current = null }
    if (!nextTake.available || !nextTake.stream_url) return
    const timeout = window.setTimeout(() => {
      if (!cancelled) setError('素材读取超时，请检查本地文件或手机连接后重新打开。')
    }, 60_000)
    void sourceLoader.current().then(value => { if (!cancelled) setUrl(value) }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '素材读取失败')
    }).finally(() => window.clearTimeout(timeout))
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [take.id, take.stream_url, take.available])

  useEffect(() => {
    if (!url || !isVideo || media.duration > 0) return
    const timeout = window.setTimeout(() => setError('素材无法播放，请检查文件是否存在、是否损坏或格式是否受支持。'), 15_000)
    return () => window.clearTimeout(timeout)
  }, [url, media.duration, isVideo])

  useEffect(() => {
    if (initialized.current || !Number.isFinite(media.duration) || media.duration <= 0) return
    initialized.current = true
    const duration = Math.round(media.duration * 1000)
    const start = Math.min(take.selected_range?.start_ms ?? 0, duration - 1)
    const end = Math.max(start + 1, Math.min(take.selected_range?.end_ms ?? duration, duration))
    setRange({ start, end })
    stage.current?.seek(start / 1000)
  }, [media.duration, take.selected_range])

  const seek = useCallback((seconds: number) => {
    rangePlayback.current = false
    if (stage.current?.isPlaying()) stage.current.togglePlay()
    desiredSeek.current = endPreview.current !== null && Math.abs(seconds - endPreview.current) < 0.001
      ? Math.max(0, seconds - 1 / 30) : seconds
    endPreview.current = null
    if (seekFrame.current !== null) return
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = null
      if (desiredSeek.current !== null) stage.current?.seek(desiredSeek.current)
    })
  }, [])

  useEffect(() => () => { if (seekFrame.current !== null) cancelAnimationFrame(seekFrame.current) }, [])

  useEffect(() => {
    if (!media.playing) return
    let frame: number
    const observe = () => {
      if (rangePlayback.current && stage.current && stage.current.getCurrentTime() * 1000 >= currentRange.current.end) {
        rangePlayback.current = false
        if (stage.current.isPlaying()) stage.current.togglePlay()
        stage.current.seek(Math.max(currentRange.current.start, currentRange.current.end - 1) / 1000)
        return
      }
      frame = requestAnimationFrame(observe)
    }
    frame = requestAnimationFrame(observe)
    return () => cancelAnimationFrame(frame)
  }, [media.playing])

  const playRange = () => {
    if (!stage.current || media.duration <= 0) return
    if (seekFrame.current !== null) { cancelAnimationFrame(seekFrame.current); seekFrame.current = null }
    if (stage.current.isPlaying()) stage.current.togglePlay()
    stage.current.seek(range.start / 1000)
    rangePlayback.current = true
    stage.current.togglePlay()
  }

  const applyDuration = (milliseconds: number) => {
    const duration = Math.round(media.duration * 1000)
    if (duration <= 0 || !Number.isFinite(milliseconds) || milliseconds <= 0) return
    const length = Math.min(duration, Math.round(milliseconds))
    const start = Math.min(Math.round(media.currentTime * 1000), duration - length)
    setRange({ start, end: start + length })
    setMarked(true)
    seek(start / 1000)
  }

  const navigate = (action: () => void) => {
    if (saving) return
    if (dirty) setPendingNavigation(() => action)
    else action()
  }

  const save = async () => {
    if (saving || media.duration <= 0) return
    setSaving(true)
    try { await onSave(selected); baseline.current = JSON.stringify(selected); toast.success('标记已保存') }
    catch (reason) { toast.error(reason instanceof Error ? reason.message : '保存失败') }
    finally { setSaving(false) }
  }

  return <>
    <Dialog open onOpenChange={open => { if (!open) onClose() }} title={take.file_name}
      headerActions={isVideo && <Button variant="primary" size="compact" disabled={!dirty || saving || adding || media.duration <= 0} onClick={() => void save()}>{saving ? '保存中' : '保存'}</Button>}
      tone="dark" className="director-range-dialog" bodyClassName="director-range-body" closeOnMaskClick={false}>
      <div className="director-range-main">
      <div className={`director-range-preview${!playable ? ' lab-shot-empty-preview' : ''}`} tabIndex={0} aria-label="素材预览" onKeyDown={event => {
        if (!isVideo || media.duration <= 0 || event.ctrlKey || event.metaKey || event.altKey) return
        if (event.key.toLowerCase() === 'i') { event.preventDefault(); setRange(current => ({ ...current, start: Math.min(Math.round(media.currentTime * 1000), current.end - 1) })); setMarked(true) }
        else if (event.key.toLowerCase() === 'o') { event.preventDefault(); setRange(current => ({ ...current, end: Math.max(Math.round(media.currentTime * 1000), current.start + 1) })); setMarked(true) }
        else if (event.code === 'Space') { event.preventDefault(); if (stage.current?.isPlaying()) stage.current.togglePlay(); else playRange() }
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); seek(Math.min(media.duration, Math.max(0, media.currentTime + (event.key === 'ArrowRight' ? 1 : -1) / 30)))
        }
      }}>
        {!playable ? <>
          <Button variant="primary" icon={<Upload size={18} />} disabled={adding} onClick={onAddMaterials}>{adding ? '添加中' : '添加素材'}</Button>
          {!phoneConnected && <p role="status">手机未连接，且本地没有可用素材。请连接手机同步素材，或添加本地素材。</p>}
        </> : error ? <span role="alert">{error}</span> : !url ? <LoadingIndicator label="正在读取素材" />
          : <PreviewStage key={take.id} ref={stage} url={url} isLivePhoto={false} hideControls onPlayStateChange={setMedia} />}
      </div>
      {isVideo && <div className="director-range-controls">
        <TrimStrip duration={media.duration} startTime={range.start / 1000} endTime={range.end / 1000}
          currentTime={media.currentTime} playing={media.playing} thumbnails={thumbnails}
          onTogglePlay={() => { if (stage.current?.isPlaying()) stage.current.togglePlay(); else playRange() }} onSeek={seek}
          onStartTimeChange={seconds => { setRange(current => ({ ...current, start: Math.round(seconds * 1000) })); setMarked(true) }}
          onEndTimeChange={seconds => { endPreview.current = seconds; setRange(current => ({ ...current, end: Math.round(seconds * 1000) })); setMarked(true) }} />
        <div className="director-range-actions">
          <Input variant="pill" fullWidth aria-label="片段备注" placeholder="片段备注" maxLength={4000} disabled={saving} value={note} onChange={event => { setNote(event.target.value); setMarked(true) }} />
          <Button disabled={saving || media.duration <= 0} onClick={() => applyDuration(shot.duration_ms)}>推荐时长</Button>
          <Button disabled={saving || media.duration <= 0} onClick={() => {
            setMarked(false)
            setNote('')
            setRange({ start: 0, end: Math.round(media.duration * 1000) })
            seek(0)
          }}>还原</Button>
        </div>
      </div>}
      </div>
      <DirectorShotInspector shot={shot} takes={takes} selectedId={take.id} disabled={saving || adding} onAddMaterials={onAddMaterials}
        onDeleteMaterial={onDeleteMaterial}
        onSelect={selectedTake => { if (selectedTake.id !== take.id) navigate(() => onSelectTake(selectedTake)) }} />
    </Dialog>
    <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null) }} title="放弃未保存的标记？" tone="dark" footer={<>
      <Button onClick={() => setPendingNavigation(null)}>继续编辑</Button>
      <Button variant="danger" onClick={() => { pendingNavigation?.(); setPendingNavigation(null) }}>放弃修改</Button>
    </>} />
  </>
}
