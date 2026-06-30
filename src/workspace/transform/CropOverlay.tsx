import { useEffect, useRef, useState } from 'react'

import type { CropRect } from '../shared/editPipeline'
import { Button } from '../../ui'
import { clampCrop, fitCropInsideImage, normalizeFineRotate, sameCrop } from './cropGeometry'

interface CropOverlayProps {
  crop: CropRect | null
  imageRect: { x: number; y: number; width: number; height: number }
  sourceAspect: number
  orientation: number
  rotate: number
  onCropChange: (crop: CropRect) => void
  onRotateChange: (rotate: number) => void
  onConfirm: () => void
  onCancel: () => void
}

type DragMode = 'move' | 'rotate' | 'tl' | 'tr' | 'bl' | 'br' | 'top' | 'right' | 'bottom' | 'left'

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

function pointerAngle(event: PointerEvent | React.PointerEvent, bounds: DOMRect): number {
  const cx = bounds.left + bounds.width / 2
  const cy = bounds.top + bounds.height / 2
  return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
}

export function CropOverlay({ crop, imageRect, sourceAspect, orientation, rotate, onCropChange, onRotateChange, onConfirm, onCancel }: CropOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const preferredCropRef = useRef<CropRect | null>(null)
  const [drag, setDrag] = useState<{ mode: DragMode; x: number; y: number; crop: CropRect; angle: number; rotate: number } | null>(null)
  const activeCrop = crop ?? DEFAULT_CROP

  useEffect(() => {
    if (crop && !preferredCropRef.current) preferredCropRef.current = crop
  }, [crop])

  useEffect(() => {
    if (!crop) {
      preferredCropRef.current = DEFAULT_CROP
      onCropChange(DEFAULT_CROP)
    }
  }, [crop, onCropChange])

  useEffect(() => {
    const preferred = preferredCropRef.current ?? activeCrop
    const fitted = fitCropInsideImage(preferred, sourceAspect, orientation, rotate)
    if (!sameCrop(fitted, activeCrop)) onCropChange(fitted)
  }, [activeCrop, sourceAspect, orientation, rotate, onCropChange])

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
      if (activeDrag.mode === 'rotate') {
        onRotateChange(normalizeFineRotate(activeDrag.rotate + pointerAngle(event, bounds) - activeDrag.angle))
        return
      }
      const dx = (event.clientX - activeDrag.x) / bounds.width
      const dy = (event.clientY - activeDrag.y) / bounds.height
      const start = activeDrag.crop
      let next = start
      if (activeDrag.mode === 'move') next = { ...start, x: start.x + dx, y: start.y + dy }
      if (activeDrag.mode === 'tl') next = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy }
      if (activeDrag.mode === 'tr') next = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy }
      if (activeDrag.mode === 'bl') next = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy }
      if (activeDrag.mode === 'br') next = { ...start, w: start.w + dx, h: start.h + dy }
      if (activeDrag.mode === 'top') next = { ...start, y: start.y + dy, h: start.h - dy }
      if (activeDrag.mode === 'right') next = { ...start, w: start.w + dx }
      if (activeDrag.mode === 'bottom') next = { ...start, h: start.h + dy }
      if (activeDrag.mode === 'left') next = { ...start, x: start.x + dx, w: start.w - dx }
      const clamped = clampCrop(next)
      preferredCropRef.current = clamped
      onCropChange(fitCropInsideImage(clamped, sourceAspect, orientation, rotate))
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
  }, [drag, onCropChange, onRotateChange, orientation, rotate, sourceAspect])

  function startDrag(event: React.PointerEvent, mode: DragMode): void {
    event.preventDefault()
    event.stopPropagation()
    const bounds = rootRef.current?.getBoundingClientRect()
    setDrag({
      mode,
      x: event.clientX,
      y: event.clientY,
      crop: activeCrop,
      angle: bounds ? pointerAngle(event, bounds) : 0,
      rotate,
    })
  }

  function startRotate(event: React.PointerEvent): void {
    startDrag(event, 'rotate')
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
      onPointerDown={startRotate}
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
        <div className="workspace-crop-grid" />
        {(['tl', 'tr', 'bl', 'br'] as const).map((mode) => (
          <button
            key={mode}
            className={`workspace-crop-corner ${mode}`}
            type="button"
            onPointerDown={(event) => startDrag(event, mode)}
            aria-label="调整裁剪区域"
          />
        ))}
        {(['top', 'right', 'bottom', 'left'] as const).map((mode) => (
          <button
            key={mode}
            className={`workspace-crop-edge ${mode}`}
            type="button"
            onPointerDown={(event) => startDrag(event, mode)}
            aria-label="调整裁剪区域"
          />
        ))}
        <div className="workspace-crop-actions">
          <Button variant="secondary" size="compact" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" size="compact" type="button" onClick={onConfirm}>
            确认裁剪
          </Button>
        </div>
      </div>
    </div>
  )
}
