import { useEffect, useRef, useState } from 'react'

import type { CropRect } from '../shared/editPipeline'
import { Button } from '../../ui'

interface CropOverlayProps {
  crop: CropRect | null
  imageRect: { x: number; y: number; width: number; height: number }
  onCropChange: (crop: CropRect) => void
  onConfirm: () => void
  onCancel: () => void
}

type DragMode = 'move' | 'tl' | 'tr' | 'bl' | 'br'

const DEFAULT_CROP: CropRect = { x: 0.12, y: 0.12, w: 0.76, h: 0.76 }

function clampCrop(crop: CropRect): CropRect {
  const min = 0.05
  const w = Math.max(min, Math.min(1, crop.w))
  const h = Math.max(min, Math.min(1, crop.h))
  return {
    x: Math.max(0, Math.min(1 - w, crop.x)),
    y: Math.max(0, Math.min(1 - h, crop.y)),
    w,
    h,
  }
}

export function CropOverlay({ crop, imageRect, onCropChange, onConfirm, onCancel }: CropOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ mode: DragMode; x: number; y: number; crop: CropRect } | null>(null)
  const activeCrop = crop ?? DEFAULT_CROP

  useEffect(() => {
    if (!crop) onCropChange(DEFAULT_CROP)
  }, [crop, onCropChange])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel()
      if (event.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel, onConfirm])

  useEffect(() => {
    if (!drag) return
    const activeDrag = drag

    function handlePointerMove(event: PointerEvent): void {
      const bounds = rootRef.current?.getBoundingClientRect()
      if (!bounds) return
      const dx = (event.clientX - activeDrag.x) / bounds.width
      const dy = (event.clientY - activeDrag.y) / bounds.height
      const start = activeDrag.crop
      let next = start
      if (activeDrag.mode === 'move') next = { ...start, x: start.x + dx, y: start.y + dy }
      if (activeDrag.mode === 'tl') next = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy }
      if (activeDrag.mode === 'tr') next = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy }
      if (activeDrag.mode === 'bl') next = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy }
      if (activeDrag.mode === 'br') next = { ...start, w: start.w + dx, h: start.h + dy }
      onCropChange(clampCrop(next))
    }

    function handlePointerUp(): void {
      setDrag(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [drag, onCropChange])

  function startDrag(event: React.PointerEvent, mode: DragMode): void {
    event.preventDefault()
    setDrag({ mode, x: event.clientX, y: event.clientY, crop: activeCrop })
  }

  return (
    <div
      ref={rootRef}
      className="workspace-crop-overlay"
      style={{
        left: imageRect.x,
        top: imageRect.y,
        width: imageRect.width,
        height: imageRect.height,
      }}
      onDoubleClick={onConfirm}
    >
      <div className="workspace-crop-mask" />
      <div
        className="workspace-crop-box"
        onPointerDown={(event) => startDrag(event, 'move')}
        style={{
          left: `${activeCrop.x * 100}%`,
          top: `${activeCrop.y * 100}%`,
          width: `${activeCrop.w * 100}%`,
          height: `${activeCrop.h * 100}%`,
        }}
      >
        {(['tl', 'tr', 'bl', 'br'] as const).map((mode) => (
          <button
            key={mode}
            className={`workspace-crop-handle ${mode}`}
            type="button"
            onPointerDown={(event) => startDrag(event, mode)}
            aria-label="调整裁剪区域"
          />
        ))}
      </div>
      <div className="workspace-crop-actions">
        <Button variant="secondary" size="compact" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" size="compact" type="button" onClick={onConfirm}>
          确认裁剪
        </Button>
      </div>
    </div>
  )
}
