import { useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'

import { ThumbImage } from '../components/ThumbImage'
import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { squareCropAroundCenter } from '../shared/aiAvatarCrop'
import { Button, Dialog, IconButton } from '../ui'
import './AiPersonAvatarDialog.css'

type Bounds = { x: number; y: number; width: number; height: number }
type CropDragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br'
const FACE_CONTEXT_SCALE = 2.4

interface AiPersonAvatarDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: AiFaceGroup | null
  items: AiSelectionItem[]
  busy: boolean
  onSave: (itemId: string, bounds: Bounds) => Promise<boolean>
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
  const [previewSize, setPreviewSize] = useState({ width: 1, height: 1 })
  const editorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: CropDragMode; x: number; y: number; crop: Bounds } | null>(null)

  useEffect(() => {
    if (!open) return
    const selected = candidates.find(({ item }) => item.path === group?.coverUrl) ?? candidates[0]
    if (!selected) return
    const width = Math.max(1, selected.item.width ?? 1)
    const height = Math.max(1, selected.item.height ?? 1)
    setSelectedId(selected.item.id)
    setPreviewSize({ width, height })
    setCrop(squareCropAroundCenter(selected.face, width, height, FACE_CONTEXT_SCALE))
  }, [candidates, group?.coverUrl, open])

  const selected = candidates.find(({ item }) => item.id === selectedId) ?? null

  function selectCandidate(item: AiSelectionItem, face: Bounds): void {
    const width = Math.max(1, item.width ?? 1)
    const height = Math.max(1, item.height ?? 1)
    setSelectedId(item.id)
    setPreviewSize({ width, height })
    setCrop(squareCropAroundCenter(face, width, height, FACE_CONTEXT_SCALE))
  }

  function resizeCrop(scale: number): void {
    if (!selected) return
    const sourceWidth = previewSize.width
    const sourceHeight = previewSize.height
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
    if (drag.mode !== 'move') {
      const left = drag.crop.x * rect.width
      const top = drag.crop.y * rect.height
      const right = (drag.crop.x + drag.crop.width) * rect.width
      const bottom = (drag.crop.y + drag.crop.height) * rect.height
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const desiredSide = drag.mode === 'tl'
        ? ((right - pointerX) + (bottom - pointerY)) / 2
        : drag.mode === 'tr'
          ? ((pointerX - left) + (bottom - pointerY)) / 2
          : drag.mode === 'bl'
            ? ((right - pointerX) + (pointerY - top)) / 2
            : ((pointerX - left) + (pointerY - top)) / 2
      const maxSide = drag.mode === 'tl'
        ? Math.min(right, bottom)
        : drag.mode === 'tr'
          ? Math.min(rect.width - left, bottom)
          : drag.mode === 'bl'
            ? Math.min(right, rect.height - top)
            : Math.min(rect.width - left, rect.height - top)
      const side = Math.max(32, Math.min(maxSide, desiredSide))
      const nextLeft = drag.mode === 'tl' || drag.mode === 'bl' ? right - side : left
      const nextTop = drag.mode === 'tl' || drag.mode === 'tr' ? bottom - side : top
      setCrop({ x: nextLeft / rect.width, y: nextTop / rect.height, width: side / rect.width, height: side / rect.height })
      return
    }
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
          <IconButton variant="ghost" size="mini" icon={<ZoomOut size={16} />} aria-label="缩小头像选区" title="缩小头像选区" onClick={() => resizeCrop(0.82)} />
          <IconButton variant="ghost" size="mini" icon={<ZoomIn size={16} />} aria-label="扩大头像选区" title="扩大头像选区" onClick={() => resizeCrop(1.2)} />
        </div>
        {selected && <div
          ref={editorRef}
          className="ai-person-avatar-image"
          style={{
            aspectRatio: `${previewSize.width} / ${previewSize.height}`,
            width: `min(100%, ${Math.min(560, 360 * previewSize.width / previewSize.height)}px)`,
          }}
        >
          <ThumbImage
            src={selected.item.thumbnailUrl ?? selected.item.path}
            alt={selected.item.name}
            draggable={false}
            onLoad={(event) => {
              if (event.currentTarget.src.startsWith('data:image/svg+xml')) return
              const width = Math.max(1, event.currentTarget.naturalWidth)
              const height = Math.max(1, event.currentTarget.naturalHeight)
              if (width === previewSize.width && height === previewSize.height) return
              setPreviewSize({ width, height })
              setCrop(squareCropAroundCenter(selected.face, width, height, FACE_CONTEXT_SCALE))
            }}
          />
          <div
            className="ai-person-avatar-crop"
            style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
            onPointerDown={(event) => {
              const mode = (event.target as HTMLElement).dataset.cropHandle as CropDragMode | undefined
              dragRef.current = { mode: mode ?? 'move', x: event.clientX, y: event.clientY, crop }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={moveCrop}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
          >
            {(['tl', 'tr', 'bl', 'br'] as const).map((mode) => <button key={mode} type="button" className={`ai-person-avatar-crop-handle ${mode}`} data-crop-handle={mode} aria-label="调整头像选区" />)}
          </div>
        </div>}
      </section>
    </div>
  </Dialog>
}
