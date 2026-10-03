import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Button } from '../ui'
import type { WatermarkPositioning, WatermarkSettings } from '../shared/types'
import { watermarkPositionStyle } from './htmlPreviewGeometry'
import './LiveWatermarkOverlay.css'

interface LiveWatermarkOverlayProps {
  src: string
  positioning: WatermarkPositioning
  opacity: number
  settings: WatermarkSettings
  editable: boolean
  onChange: (settings: WatermarkSettings) => void
}

interface WatermarkGesture {
  pointerId: number
  startX: number
  startY: number
  centerX: number
  centerY: number
  width: number
  height: number
  stageWidth: number
  stageHeight: number
}

function watermarkBounds(element: HTMLButtonElement) {
  const stage = element.parentElement?.getBoundingClientRect()
  const watermark = element.getBoundingClientRect()
  if (!stage?.width || !stage.height) return null
  return {
    centerX: (watermark.left - stage.left + watermark.width / 2) / stage.width,
    centerY: (watermark.top - stage.top + watermark.height / 2) / stage.height,
    width: watermark.width / stage.width,
    height: watermark.height / stage.height,
    stageWidth: stage.width,
    stageHeight: stage.height,
  }
}

export function LiveWatermarkOverlay({ src, positioning, opacity, settings, editable, onChange }: LiveWatermarkOverlayProps) {
  const gesture = useRef<WatermarkGesture | null>(null)
  useEffect(() => { gesture.current = null }, [src, editable])

  const move = (centerX: number, centerY: number, width: number, height: number) => {
    onChange({ ...settings, placement: {
      mode: 'free',
      centerX: Math.min(1 - width / 2, Math.max(width / 2, centerX)),
      centerY: Math.min(1 - height / 2, Math.max(height / 2, centerY)),
    } })
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    const bounds = watermarkBounds(event.currentTarget)
    if (!bounds) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { ...bounds, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY }
  }

  const drag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    move(current.centerX + (event.clientX - current.startX) / current.stageWidth,
      current.centerY + (event.clientY - current.startY) / current.stageHeight, current.width, current.height)
  }

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    gesture.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const keyMove = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    const bounds = watermarkBounds(event.currentTarget)
    if (!bounds) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 0.001 : 0.01
    move(bounds.centerX + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
      bounds.centerY + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), bounds.width, bounds.height)
  }

  const image = <img src={src} alt="" draggable={false} style={{ opacity }} />
  const style = watermarkPositionStyle(positioning)
  return editable ? (
    <Button variant="ghost" className="live-watermark-overlay is-editable" style={style}
      aria-label="移动水印" title="拖动调整位置" onPointerDown={startDrag} onPointerMove={drag}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { gesture.current = null }} onKeyDown={keyMove}>
      {image}
    </Button>
  ) : <div className="live-watermark-overlay" style={style}>{image}</div>
}
