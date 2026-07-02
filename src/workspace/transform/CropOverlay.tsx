import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CropRect } from '../shared/editPipeline'
import { fitCropInsideImage, maxCropInsideImage, moveCropInsideImage, normalizeFineRotate, resizeCropInsideImage, sameCrop, frameAspect, type CropDragMode } from './cropGeometry'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'

const DEFAULT_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

function pointerAngle(event: PointerEvent | React.PointerEvent, bounds: DOMRect): number {
  const cx = bounds.left + bounds.width / 2
  const cy = bounds.top + bounds.height / 2
  return (Math.atan2(event.clientY - cy, event.clientX - cx) * 180) / Math.PI
}

export function CropOverlay() {
  const edit = useWorkspaceEdit()
  const canvas = useWorkspaceCanvas()

  const rootRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const preferredCropRef = useRef<CropRect | null>(null)
  const activeCropRef = useRef<CropRect>(DEFAULT_CROP)
  const cropFrameKeyRef = useRef('')
  const rotateKeyRef = useRef('')
  const [drag, setDrag] = useState<{ mode: CropDragMode; x: number; y: number; crop: CropRect; angle: number; rotate: number } | null>(null)

  const activeTransform = edit.cropActive && edit.transformDraft ? edit.transformDraft : edit.pipeline.transform
  const crop = activeTransform.crop
  const orientation = activeTransform.orientation
  const rotate = activeTransform.rotate
  const activeCrop = crop ?? DEFAULT_CROP

  const aspectRatio = useMemo(() => {
    if (edit.cropPreset === 'free') return null
    if (edit.cropPreset === 'original') return frameAspect(canvas.sourceAspect, orientation)
    const w = edit.cropSize.width || Math.round(canvas.sourceAspect * 2160)
    const h = edit.cropSize.height || 2160
    return w / Math.max(h, 1)
  }, [edit.cropPreset, edit.cropSize, canvas.sourceAspect, orientation])

  const onCropChange = useCallback((nextCrop: CropRect) => {
    edit.setTransformDraft((current) => ({ ...(current ?? edit.pipeline.transform), crop: nextCrop }))
  }, [edit.setTransformDraft, edit.pipeline.transform])

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
    const cropFrameKey = `${canvas.sourceAspect}:${orientation}:${aspectRatio ?? 'free'}`
    if (cropFrameKeyRef.current === cropFrameKey) return
    cropFrameKeyRef.current = cropFrameKey
    const fitted = maxCropInsideImage({ sourceAspect: canvas.sourceAspect, orientation, rotate, aspectRatio })
    preferredCropRef.current = fitted
    if (!sameCrop(fitted, activeCropRef.current)) onCropChange(fitted)
  }, [aspectRatio, canvas.sourceAspect, orientation, rotate, onCropChange])

  useEffect(() => {
    const rotateKey = `${canvas.sourceAspect}:${orientation}:${rotate}:${aspectRatio ?? 'free'}`
    if (rotateKeyRef.current === rotateKey) return
    rotateKeyRef.current = rotateKey
    const preferred = preferredCropRef.current ?? activeCropRef.current
    const fitted = fitCropInsideImage(preferred, canvas.sourceAspect, orientation, rotate)
    if (!sameCrop(fitted, activeCropRef.current)) onCropChange(fitted)
  }, [aspectRatio, canvas.sourceAspect, orientation, rotate, onCropChange])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') edit.cancelCrop()
      if (event.key === 'Enter') edit.confirmCrop()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [edit.cancelCrop, edit.confirmCrop])

  useEffect(() => {
    if (!drag) return
    const activeDrag = drag

    function handlePointerMove(event: PointerEvent): void {
      const bounds = frameRef.current?.getBoundingClientRect()
      if (!bounds) return
      if (activeDrag.mode === 'rotate') {
        edit.handleRotateChange(normalizeFineRotate(activeDrag.rotate + pointerAngle(event, bounds) - activeDrag.angle))
        return
      }
      const dx = (event.clientX - activeDrag.x) / bounds.width
      const dy = (event.clientY - activeDrag.y) / bounds.height
      const options = { sourceAspect: canvas.sourceAspect, orientation, rotate, aspectRatio }
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
  }, [aspectRatio, canvas.sourceAspect, drag, onCropChange, edit.handleRotateChange, orientation, rotate])

  function startDrag(event: React.PointerEvent, mode: CropDragMode): void {
    event.preventDefault()
    event.stopPropagation()
    const bounds = frameRef.current?.getBoundingClientRect()
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
      onPointerDown={startRotate}
      onDoubleClick={edit.confirmCrop}
    >
      <div
        ref={frameRef}
        className="workspace-crop-frame"
        style={{
          left: canvas.imageRect.x,
          top: canvas.imageRect.y,
          width: canvas.imageRect.width,
          height: canvas.imageRect.height,
        }}
      >
        <div className="workspace-crop-mask" />
        <div
          className="workspace-crop-dim"
          style={{
            clipPath: `polygon(0 0, 0 100%, ${activeCrop.x * 100}% 100%, ${activeCrop.x * 100}% ${activeCrop.y * 100}%, ${(activeCrop.x + activeCrop.w) * 100}% ${activeCrop.y * 100}%, ${(activeCrop.x + activeCrop.w) * 100}% ${(activeCrop.y + activeCrop.h) * 100}%, ${activeCrop.x * 100}% ${(activeCrop.y + activeCrop.h) * 100}%, ${activeCrop.x * 100}% 100%, 100% 100%, 100% 0)`,
          }}
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
    </div>
  )
}

// Re-export for convenience
export type { CropPreset } from '../transform/TransformPanel'
