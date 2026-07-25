import { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'

import { ThumbImage } from '../components/ThumbImage'
import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog, IconButton } from '../ui'
import './AiPersonAvatarDialog.css'

type Bounds = { x: number; y: number; width: number; height: number }

interface AiPersonAvatarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: AiFaceGroup | null
  items: AiSelectionItem[]
  busy: boolean
  onSave: (itemId: string, bounds: Bounds) => Promise<boolean>
}

function initialCrop(item: AiSelectionItem, face: Bounds): Bounds {
  const width = Math.max(1, item.width ?? 1)
  const height = Math.max(1, item.height ?? 1)
  const sidePixels = Math.min(width, height, Math.max(face.width * width, face.height * height) * 1.8)
  const cropWidth = sidePixels / width
  const cropHeight = sidePixels / height
  return {
    x: Math.max(0, Math.min(1 - cropWidth, face.x + face.width / 2 - cropWidth / 2)),
    y: Math.max(0, Math.min(1 - cropHeight, face.y + face.height / 2 - cropHeight / 2)),
    width: cropWidth,
    height: cropHeight,
  }
}

export function AiPersonAvatarDialog({ open, onOpenChange, group, items, busy, onSave }: AiPersonAvatarDialogProps) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const candidates = useMemo(() => {
    const unique = new Map<string, { item: AiSelectionItem; face: Bounds }>()
    for (const member of group?.memberFaces ?? []) {
      const item = itemsById.get(member.itemId)
      if (item && item.kind === 'image' && !unique.has(item.id)) unique.set(item.id, { item, face: member.bounds })
    }
    return [...unique.values()]
  }, [group?.memberFaces, itemsById])
  const [selectedId, setSelectedId] = useState('')
  const [crop, setCrop] = useState<Bounds>({ x: 0, y: 0, width: 1, height: 1 })
  const editorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; crop: Bounds } | null>(null)

  useEffect(() => {
    if (!open) return
    const selected = candidates.find(({ item }) => item.path === group?.coverUrl) ?? candidates[0]
    if (!selected) return
    setSelectedId(selected.item.id)
    setCrop(initialCrop(selected.item, selected.face))
  }, [candidates, group?.coverUrl, open])

  const selected = candidates.find(({ item }) => item.id === selectedId) ?? null

  function selectCandidate(item: AiSelectionItem, face: Bounds): void {
    setSelectedId(item.id)
    setCrop(initialCrop(item, face))
  }

  function resizeCrop(scale: number): void {
    if (!selected) return
    const sourceWidth = Math.max(1, selected.item.width ?? 1)
    const sourceHeight = Math.max(1, selected.item.height ?? 1)
    const currentPixels = crop.width * sourceWidth
    const sidePixels = Math.max(32, Math.min(sourceWidth, sourceHeight, currentPixels * scale))
    const width = sidePixels / sourceWidth
    const height = sidePixels / sourceHeight
    const centerX = crop.x + crop.width / 2
    const centerY = crop.y + crop.height / 2
    setCrop({
      x: Math.max(0, Math.min(1 - width, centerX - width / 2)),
      y: Math.max(0, Math.min(1 - height, centerY - height / 2)),
      width,
      height,
    })
  }

  function moveCrop(event: React.PointerEvent): void {
    const drag = dragRef.current
    const editor = editorRef.current
    if (!drag || !editor) return
    const rect = editor.getBoundingClientRect()
    const x = drag.crop.x + (event.clientX - drag.x) / rect.width
    const y = drag.crop.y + (event.clientY - drag.y) / rect.height
    setCrop({ ...drag.crop, x: Math.max(0, Math.min(1 - drag.crop.width, x)), y: Math.max(0, Math.min(1 - drag.crop.height, y)) })
  }

  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title={group ? `${group.name}的头像` : '人物头像'}
    className="ai-person-avatar-dialog"
    footer={<>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" disabled={busy || !selected} onClick={async () => {
        if (selected && await onSave(selected.item.id, crop)) onOpenChange(false)
      }}>保存头像</Button>
    </>}
  >
    <div className="ai-person-avatar-body">
      <aside className="ai-person-avatar-candidates">
        <strong>选择照片</strong>
        <div>{candidates.map(({ item, face }) => <button
          key={item.id}
          type="button"
          className={selectedId === item.id ? 'selected' : ''}
          aria-label={`选择 ${item.name}`}
          onClick={() => selectCandidate(item, face)}
        ><ThumbImage src={item.thumbnailUrl ?? item.path} alt="" /></button>)}</div>
      </aside>
      <section className="ai-person-avatar-editor">
        <div className="ai-person-avatar-tools">
          <IconButton variant="ghost" size="mini" icon={<ZoomOut size={16} />} aria-label="扩大头像选区" title="扩大头像选区" onClick={() => resizeCrop(1.2)} />
          <IconButton variant="ghost" size="mini" icon={<ZoomIn size={16} />} aria-label="缩小头像选区" title="缩小头像选区" onClick={() => resizeCrop(0.82)} />
        </div>
        {selected && <div
          ref={editorRef}
          className="ai-person-avatar-image"
          style={{ aspectRatio: `${Math.max(1, selected.item.width ?? 1)} / ${Math.max(1, selected.item.height ?? 1)}` }}
        >
          <ThumbImage src={selected.item.thumbnailUrl ?? selected.item.path} alt={selected.item.name} draggable={false} />
          <div
            className="ai-person-avatar-crop"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
            onPointerDown={(event) => {
              dragRef.current = { x: event.clientX, y: event.clientY, crop }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={moveCrop}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
          />
        </div>}
      </section>
    </div>
  </Dialog>
}
