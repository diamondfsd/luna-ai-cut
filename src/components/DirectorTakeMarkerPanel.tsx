import { useState } from 'react'
import { Tag, Play, MapPin, MoreHorizontal } from 'lucide-react'
import type { DirectorTakeMarker } from '../shared/types/directorLab'
import { directorMarkerTime, validateDirectorTakeMarkers } from '../lib/directorTakeMarkers'
import { Button, Dialog, IconButton, Input, Select, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, toast } from '../ui'
import './DirectorTakeMarkerPanel.css'

interface Props {
  markers: DirectorTakeMarker[]
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

export function DirectorTakeMarkerPanel({ markers, durationMs, range, disabled, getPosition, onPause, onJump, onSave }: Props) {
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
  return <section className="director-marker-panel" aria-label="当前素材亮点标签">
    <div className="director-marker-heading"><span>亮点标签 · {markers.length}</span>
      <IconButton variant="ghost" size="compact" icon={<Tag size={18} />} aria-label="添加亮点标签" title="添加亮点标签"
        disabled={busy || durationMs <= 0 || markers.length >= 200} onClick={create} /></div>
    <div className="director-marker-list">{markers.map(marker => <div className="director-marker-row" key={marker.id}>
      <Button variant="utility" className="director-marker-jump" disabled={busy || durationMs <= 0} onClick={() => onJump(marker)}>
        <span className="director-marker-time">{marker.end_ms === null ? <MapPin size={13} /> : <Play size={13} />}
          {directorMarkerTime(marker.start_ms)}{marker.end_ms === null ? '' : ` – ${directorMarkerTime(marker.end_ms)}`}</span>
        <span className="director-marker-text">{marker.text}</span>
      </Button>
      <DropdownMenu><DropdownMenuTrigger asChild><IconButton variant="ghost" size="mini" icon={<MoreHorizontal size={14} />} aria-label="标签操作" disabled={busy} /></DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => { onPause(); setDraft({ id: marker.id, type: marker.end_ms === null ? 'point' : 'range', start: String(marker.start_ms / 1000), end: String((marker.end_ms ?? range.end) / 1000), text: marker.text }) }}>编辑</DropdownMenuItem>
          <DropdownMenuItem destructive onSelect={() => setDeleting(marker)}>删除</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>)}</div>
    <Dialog open={Boolean(draft)} title="亮点标签" tone="dark" onOpenChange={open => !open && !saving && setDraft(null)} showCloseButton={!saving}
      footer={<><Button disabled={saving} onClick={() => setDraft(null)}>取消</Button>
        <Button variant="primary" disabled={busy || !valid} onClick={() => {
          if (draftMarker) void save([...markers.filter(marker => marker.id !== draftMarker.id), draftMarker])
        }}>{saving ? '保存中' : '保存标签'}</Button></>}>
      {draft && <div className="director-marker-form">
        <Select fullWidth value={draft.type} options={[{ value: 'point', label: '时间点标签' }, { value: 'range', label: '范围标签' }]}
          onValueChange={type => setDraft({ ...draft, type: type as Draft['type'],
            ...(type === 'range' ? { start: String(range.start / 1000), end: String(range.end / 1000) } : {}) })} />
        <label> {draft.type === 'point' ? '时间点（秒）' : '开始（秒）'}<Input variant="pill" fullWidth type="number" min={0} max={durationMs / 1000} step="0.001"
          value={draft.start} onChange={event => setDraft({ ...draft, start: event.target.value })} /></label>
        {draft.type === 'range' && <label>结束（秒）<Input variant="pill" fullWidth type="number" min={0} max={durationMs / 1000} step="0.001"
          value={draft.end} onChange={event => setDraft({ ...draft, end: event.target.value })} /></label>}
        <Input variant="pill" fullWidth aria-label="标签描述" placeholder="标签描述" autoFocus maxLength={1000} value={draft.text}
          onChange={event => setDraft({ ...draft, text: event.target.value })} />
      </div>}
    </Dialog>
    <Dialog open={Boolean(deleting)} title="删除亮点标签？" tone="dark" onOpenChange={open => !open && !saving && setDeleting(null)} showCloseButton={!saving}
      description={deleting?.text} footer={<><Button disabled={saving} onClick={() => setDeleting(null)}>取消</Button>
        <Button variant="danger" disabled={busy} onClick={() => void save(markers.filter(marker => marker.id !== deleting?.id))}>{saving ? '删除中' : '删除'}</Button></>} />
  </section>
}
