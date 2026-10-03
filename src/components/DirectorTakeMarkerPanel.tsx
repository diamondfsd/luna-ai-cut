import { useState } from 'react'
import { Tag, Play, Check, X, Trash2 } from 'lucide-react'
import type { DirectorTakeMarker } from '../shared/types/directorLab'
import { directorMarkerTime, validateDirectorTakeMarkers } from '../lib/directorTakeMarkers'
import { Button, Dialog, IconButton, Input, Select, toast } from '../ui'
import { DirectorMarkerThumbnail } from './DirectorMarkerThumbnail'
import './DirectorTakeMarkerPanel.css'

interface Props {
  markers: DirectorTakeMarker[]
  videoSource: string | null
  durationMs: number
  range: { start: number; end: number }
  disabled: boolean
  getPosition: () => number
  onPause: () => void
  onJump: (marker: DirectorTakeMarker) => void
  onSave: (markers: DirectorTakeMarker[]) => Promise<void>
}

interface Draft {
  id: string
  type: 'point' | 'range'
  start: string
  end: string
  text: string
}

export function DirectorTakeMarkerPanel({ markers, videoSource, durationMs, range, disabled, getPosition, onPause, onJump, onSave }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<DirectorTakeMarker | null>(null)
  const [saving, setSaving] = useState(false)
  const busy = disabled || saving
  const create = () => {
    const position = Math.min(durationMs, Math.max(0, Math.round(getPosition())))
    onPause()
    setDraft({ id: crypto.randomUUID(), type: 'point', start: String(position / 1000), end: String(range.end / 1000), text: '' })
  }
  const save = async (next: DirectorTakeMarker[]) => {
    if (saving) return
    setSaving(true)
    try {
      await onSave(validateDirectorTakeMarkers(next, durationMs))
      setDraft(null)
      setDeleting(null)
    } catch (error) { toast.error(error instanceof Error ? error.message : '标签保存失败') }
    finally { setSaving(false) }
  }
  const draftMarker = draft ? { id: draft.id, start_ms: Math.round(Number(draft.start) * 1000),
    end_ms: draft.type === 'range' ? Math.round(Number(draft.end) * 1000) : null, text: draft.text } : null
  let valid = false
  if (draftMarker && draft?.start.trim() && (draft.type === 'point' || draft.end.trim())) {
    try { validateDirectorTakeMarkers([draftMarker], durationMs); valid = true } catch { valid = false }
  }
  const commitDraft = () => {
    if (!busy && valid && draftMarker) void save([...markers.filter(marker => marker.id !== draftMarker.id), draftMarker])
  }
  const edit = (marker: DirectorTakeMarker) => {
    if (busy || draft) return
    onPause()
    setDraft({ id: marker.id, type: marker.end_ms === null ? 'point' : 'range', start: String(marker.start_ms / 1000),
      end: String((marker.end_ms ?? range.end) / 1000), text: marker.text })
  }
  const rows = draftMarker && !markers.some(marker => marker.id === draftMarker.id) ? [draftMarker, ...markers] : markers
  return <section className="director-marker-panel" aria-label="当前素材亮点标签">
    <div className="director-marker-heading"><span>亮点标签 · {markers.length}</span>
      <IconButton variant="ghost" size="compact" icon={<Tag size={18} />} aria-label="添加亮点标签" title="添加亮点标签"
        disabled={busy || Boolean(draft) || durationMs <= 0 || markers.length >= 200} onClick={create} /></div>
    <div className="director-marker-list">{rows.map(savedMarker => {
      const editing = draft?.id === savedMarker.id
      const marker = editing && draftMarker ? draftMarker : savedMarker
      const positionValid = Number.isSafeInteger(marker.start_ms) && marker.start_ms >= 0 && marker.start_ms <= durationMs
      return <div className="director-marker-row" key={marker.id}>
        <Button variant="utility" className="director-marker-jump" aria-label={`定位到 ${directorMarkerTime(positionValid ? marker.start_ms : 0)}`}
          title="定位到标签画面" disabled={busy || durationMs <= 0 || !positionValid}
          onClick={() => { onPause(); onJump({ ...marker, end_ms: null }) }}>
          <DirectorMarkerThumbnail source={videoSource} positionMs={positionValid ? marker.start_ms : 0} />
        </Button>
        <div className="director-marker-content">
          <Input variant="pill" fullWidth aria-label="标签描述" placeholder="填写亮点描述" maxLength={1000}
            autoFocus={editing && !markers.some(existing => existing.id === marker.id)}
            disabled={busy || Boolean(draft && !editing)} value={editing ? draft.text : marker.text}
            onFocus={() => edit(marker)} onChange={event => {
              if (editing) setDraft({ ...draft, text: event.target.value })
            }} onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commitDraft() }
              if (event.key === 'Escape' && editing) { event.preventDefault(); event.stopPropagation(); if (!saving) setDraft(null) }
            }} />
          {editing ? <div className="director-marker-controls">
            <Select variant="compact" placeholder="标签类型" disabled={busy} value={draft.type}
              options={[{ value: 'point', label: '时间点' }, { value: 'range', label: '范围' }]}
              onValueChange={type => setDraft({ ...draft, type: type as Draft['type'],
                ...(type === 'range' ? { start: String(range.start / 1000), end: String(range.end / 1000) } : {}) })} />
            <Input variant="compact" className="director-marker-bound" aria-label={draft.type === 'point' ? '时间点（秒）' : '开始（秒）'}
              type="number" min={0} max={durationMs / 1000} step="0.001" disabled={busy} value={draft.start}
              onChange={event => setDraft({ ...draft, start: event.target.value })} />
            {draft.type === 'range' && <Input variant="compact" className="director-marker-bound" aria-label="结束（秒）"
              type="number" min={0} max={durationMs / 1000} step="0.001" disabled={busy} value={draft.end}
              onChange={event => setDraft({ ...draft, end: event.target.value })} />}
            <IconButton variant="ghost" size="mini" icon={<Check size={16} />} aria-label="保存标签" title="保存标签（Enter）"
              disabled={busy || !valid} onClick={commitDraft} />
            <IconButton variant="ghost" size="mini" icon={<X size={16} />} aria-label="取消编辑" title="取消编辑"
              disabled={saving} onClick={() => setDraft(null)} />
          </div> : <div className="director-marker-controls">
            <span className="director-marker-time">{directorMarkerTime(marker.start_ms)}{marker.end_ms === null ? '' : ` – ${directorMarkerTime(marker.end_ms)}`}</span>
            {marker.end_ms !== null && <IconButton variant="ghost" size="mini" icon={<Play size={14} />} aria-label="播放标签范围"
              title="播放标签范围" disabled={busy || durationMs <= 0} onClick={() => onJump(marker)} />}
            <IconButton variant="ghost" size="mini" icon={<Trash2 size={14} />} aria-label="删除标签" title="删除标签"
              disabled={busy || Boolean(draft)} onClick={() => setDeleting(marker)} />
          </div>}
        </div>
      </div>
    })}</div>
    <Dialog open={Boolean(deleting)} title="删除亮点标签？" tone="dark" onOpenChange={open => !open && !saving && setDeleting(null)} showCloseButton={!saving}
      description={deleting?.text} footer={<><Button disabled={saving} onClick={() => setDeleting(null)}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={() => void save(markers.filter(marker => marker.id !== deleting?.id))}>{saving ? '删除中' : '删除'}</Button></>} />
  </section>
}
