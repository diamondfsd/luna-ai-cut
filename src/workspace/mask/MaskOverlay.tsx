import { useEffect, useRef, useState } from 'react'

import { DEFAULT_POINT_SEGMENTATION_MODEL_ID } from '../../shared/segmentationModels'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import './MaskOverlay.css'

function drawBrush(
  data: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  erase: boolean,
): void {
  const minX = Math.max(0, Math.floor(x - radius))
  const maxX = Math.min(width - 1, Math.ceil(x + radius))
  const minY = Math.max(0, Math.floor(y - radius))
  const maxY = Math.min(height - 1, Math.ceil(y + radius))
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const distance = Math.hypot(px - x, py - y)
      if (distance > radius) continue
      const edge = Math.max(0, Math.min(1, (radius - distance) / Math.max(1, radius * 0.25)))
      const index = py * width + px
      const amount = Math.round(edge * 255)
      data[index] = erase ? Math.min(data[index], 255 - amount) : Math.max(data[index], amount)
    }
  }
}

export function MaskOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<Uint8Array | null>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    draftRef.current = mask.maskData ? new Uint8Array(mask.maskData) : null
  }, [mask.maskData])

  const displaySize = (() => {
    const aspect = Math.max(0.01, canvas.imageRect.width / Math.max(1, canvas.imageRect.height))
    return aspect >= 1
      ? { width: 512, height: Math.max(1, Math.round(512 / aspect)) }
      : { width: Math.max(1, Math.round(512 * aspect)), height: 512 }
  })()

  function displayToSource(x: number, y: number): { x: number; y: number } {
    const transform = edit.pipeline.transform
    const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const orientation = ((transform.orientation % 180) + 180) % 180
    const swapsAxes = orientation >= 45 && orientation <= 135
    const frameWidth = swapsAxes ? 1 : canvas.sourceAspect
    const frameHeight = swapsAxes ? canvas.sourceAspect : 1
    let centeredX = (crop.x + x * crop.w - 0.5) * frameWidth
    let centeredY = (crop.y + y * crop.h - 0.5) * frameHeight
    centeredX = centeredX / Math.max(transform.scale, 0.0001)
    centeredY = centeredY / Math.max(transform.scale, 0.0001)
    const radians = (transform.orientation + transform.rotate) * Math.PI / 180
    const sine = Math.sin(radians)
    const cosine = Math.cos(radians)
    let sourceX = centeredX * cosine + centeredY * sine
    let sourceY = -centeredX * sine + centeredY * cosine
    if (transform.flipH) sourceX = -sourceX
    if (transform.flipV) sourceY = -sourceY
    return {
      x: sourceX / Math.max(canvas.sourceAspect, 0.0001) + 0.5,
      y: sourceY + 0.5,
    }
  }

  function render(data: Uint8Array): void {
    const element = canvasRef.current
    if (!element || !mask.maskSize) return
    const context = element.getContext('2d')
    if (!context) return
    const image = context.createImageData(displaySize.width, displaySize.height)
    for (let y = 0; y < displaySize.height; y++) {
      for (let x = 0; x < displaySize.width; x++) {
        const source = displayToSource((x + 0.5) / displaySize.width, (y + 0.5) / displaySize.height)
        const sourceX = Math.max(0, Math.min(mask.maskSize.width - 1, Math.floor(source.x * mask.maskSize.width)))
        const sourceY = Math.max(0, Math.min(mask.maskSize.height - 1, Math.floor(source.y * mask.maskSize.height)))
        const outputIndex = y * displaySize.width + x
        const alpha = source.x < 0 || source.x > 1 || source.y < 0 || source.y > 1
          ? 0
          : Math.round(data[sourceY * mask.maskSize.width + sourceX] * 0.55)
        image.data[outputIndex * 4] = 255
        image.data[outputIndex * 4 + 1] = 52
        image.data[outputIndex * 4 + 2] = 76
        image.data[outputIndex * 4 + 3] = alpha
      }
    }
    context.putImageData(image, 0, 0)
  }

  useEffect(() => {
    if (mask.maskData) render(mask.maskData)
    // render depends on the same visual inputs listed here and is intentionally local to this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.imageRect, canvas.sourceAspect, edit.pipeline.transform, mask.maskData, mask.maskSize])

  if (!mask.editing || !mask.maskSize) return null
  const imageRect = canvas.imageRect

  const brushCursorDiameter = (() => {
    if (!cursorPoint) return mask.brushSize
    const centerX = cursorPoint.x / Math.max(1, imageRect.width)
    const centerY = cursorPoint.y / Math.max(1, imageRect.height)
    const center = displayToSource(centerX, centerY)
    const stepX = displayToSource(centerX + 1 / Math.max(1, imageRect.width), centerY)
    const stepY = displayToSource(centerX, centerY + 1 / Math.max(1, imageRect.height))
    const sourcePerPixelX = Math.hypot(
      (stepX.x - center.x) * mask.maskSize.width,
      (stepX.y - center.y) * mask.maskSize.height,
    )
    const sourcePerPixelY = Math.hypot(
      (stepY.x - center.x) * mask.maskSize.width,
      (stepY.y - center.y) * mask.maskSize.height,
    )
    const sourcePerPixel = Math.max(0.001, (sourcePerPixelX + sourcePerPixelY) / 2)
    return Math.max(2, mask.brushSize / sourcePerPixel)
  })()

  function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    const source = displayToSource((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    return {
      x: Math.max(0, Math.min(mask.maskSize!.width - 1, source.x * mask.maskSize!.width)),
      y: Math.max(0, Math.min(mask.maskSize!.height - 1, source.y * mask.maskSize!.height)),
    }
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>): void {
    const data = draftRef.current
    if (mask.busy || !data || !mask.maskSize) return
    const point = pointForEvent(event)
    const previous = lastPointRef.current ?? point
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const radius = mask.brushSize / 2
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.3)))
    for (let step = 0; step <= steps; step++) {
      const ratio = step / steps
      drawBrush(
        data,
        mask.maskSize.width,
        mask.maskSize.height,
        previous.x + (point.x - previous.x) * ratio,
        previous.y + (point.y - previous.y) * ratio,
        radius,
        mask.brushMode === 'erase',
      )
    }
    lastPointRef.current = point
    render(data)
  }

  function restoreCommittedMask(): void {
    draftRef.current = mask.maskData ? new Uint8Array(mask.maskData) : null
    if (draftRef.current) {
      render(draftRef.current)
      return
    }
    const context = canvasRef.current?.getContext('2d')
    context?.clearRect(0, 0, displaySize.width, displaySize.height)
  }

  return (
    <div
      className="workspace-mask-overlay-shell"
      style={{ left: imageRect.x, top: imageRect.y, width: imageRect.width, height: imageRect.height }}
    >
      <canvas
        ref={canvasRef}
        className="workspace-mask-overlay"
        width={displaySize.width}
        height={displaySize.height}
        style={{
          opacity: mask.showOverlay ? 1 : 0,
          cursor: mask.busy ? 'wait' : mask.semanticPicking ? 'crosshair' : undefined,
        }}
        onPointerEnter={(event) => setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })}
        onPointerLeave={() => setCursorPoint(null)}
        onPointerDown={(event) => {
          if (mask.busy) return
          if (mask.semanticPicking) {
            const point = pointForEvent(event)
            void mask.generateSemanticMask({
              x: point.x / mask.maskSize!.width,
              y: point.y / mask.maskSize!.height,
            }, undefined, DEFAULT_POINT_SEGMENTATION_MODEL_ID)
            mask.setSemanticPicking(false)
            return
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          lastPointRef.current = null
          paint(event)
        }}
        onPointerMove={(event) => {
          setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
          if (!mask.busy && event.currentTarget.hasPointerCapture(event.pointerId)) paint(event)
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          lastPointRef.current = null
          if (mask.busy) {
            restoreCommittedMask()
            return
          }
          if (draftRef.current) void mask.commitMask(new Uint8Array(draftRef.current))
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          lastPointRef.current = null
          setCursorPoint(null)
          restoreCommittedMask()
        }}
      />
      {!mask.busy && !mask.semanticPicking && cursorPoint && (
        <span
          className={`workspace-mask-brush-cursor${mask.brushMode === 'erase' ? ' is-erase' : ''}`}
          style={{
            left: cursorPoint.x,
            top: cursorPoint.y,
            width: brushCursorDiameter,
            height: brushCursorDiameter,
          }}
        />
      )}
    </div>
  )
}
