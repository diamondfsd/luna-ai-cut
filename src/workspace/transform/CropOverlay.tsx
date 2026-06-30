import { RotateCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { IconButton } from '../../ui'
import type { CropRect } from '../shared/editPipeline'
import { fitCropInsideImage, maxCropInsideImage, moveCropInsideImage, normalizeFineRotate, resizeCropInsideImage, sameCrop, type CropDragMode } from './cropGeometry'

interface CropOverlayProps {
  crop: CropRect | null
  imageRect: { x: number; y: number; width: number; height: number }
  sourceAspect: number
  orientation: number
  rotate: number
  aspectRatio: number | null
  onCropChange: (crop: CropRect) => void
  onRotateChange: (rotate: number) => void
  onConfirm: () => void
  onCancel: () => void
}

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

function pointerAngle(event: PointerEvent | React.PointerEvent, bounds: DOMRect): number {
  const cx = bounds.left + bounds.width / 2
  const cy = bounds.top + bounds.height / 2
  return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
}

export function CropOverlay({ crop, imageRect, sourceAspect, orientation, rotate, aspectRatio, onCropChange, onRotateChange, onConfirm, onCancel }: CropOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const preferredCropRef = useRef<CropRect | null>(null)
  const activeCropRef = useRef<CropRect>(DEFAULT_CROP)
  const cropFrameKeyRef = useRef('')
  const rotateKeyRef = useRef('')
  const [drag, setDrag] = useState<{ mode: CropDragMode; x: number; y: number; crop: CropRect; angle: number; rotate: number } | null>(null)
  const activeCrop = crop ?? DEFAULT_CROP

  useEffect(() => {
    activeCropRef.current = activeCrop
  }, [activeCrop])

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
    const cropFrameKey = `${sourceAspect}:${orientation}:${aspectRatio ?? 'free'}`
    if (cropFrameKeyRef.current === cropFrameKey) return
    cropFrameKeyRef.current = cropFrameKey
    const fitted = maxCropInsideImage({ sourceAspect, orientation, rotate, aspectRatio })
    preferredCropRef.current = fitted
    if (!sameCrop(fitted, activeCropRef.current)) onCropChange(fitted)
  }, [aspectRatio, sourceAspect, orientation, rotate, onCropChange])

  useEffect(() => {
    const rotateKey = `${sourceAspect}:${orientation}:${rotate}:${aspectRatio ?? 'free'}`
    if (rotateKeyRef.current === rotateKey) return
    rotateKeyRef.current = rotateKey
    const preferred = preferredCropRef.current ?? activeCropRef.current
    const fitted = fitCropInsideImage(preferred, sourceAspect, orientation, rotate)
    if (!sameCrop(fitted, activeCropRef.current)) onCropChange(fitted)
  }, [aspectRatio, sourceAspect, orientation, rotate, onCropChange])

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
      const options = { sourceAspect, orientation, rotate, aspectRatio }
      const next = activeDrag.mode === 'move'
        ? moveCropInsideImage(activeDrag.crop, dx, dy, options)
        : resizeCropInsideImage(activeDrag.crop, activeDrag.mode, dx, dy, options)
      preferredCropRef.current = next
      onCropChange(next)
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
  }, [aspectRatio, drag, onCropChange, onRotateChange, orientation, rotate, sourceAspect])

  function startDrag(event: React.PointerEvent, mode: CropDragMode): void {
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
      <IconButton
        className="workspace-crop-rotate-handle"
        variant="light"
        size="compact"
        icon={<RotateCw size={17} />}
        aria-label="旋转裁剪"
        onPointerDown={startRotate}
      />
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
      </div>
    </div>
  )
}
