import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

import { toast } from '../../ui'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { drawMaskBrush } from '../mask/maskManualRasterization'
import { buildMaskOverlayPreview } from '../mask/maskOverlayPreview'
import { applyMaskSelectionOperation } from '../mask/maskSelectionOperations'
import {
  BEAUTY_MANUAL_RETOUCH_LAYER_ID,
  createManualBeautyRetouchLayer,
} from './beautyLayers'
import './BeautyRetouchOverlay.css'

const DEFAULT_MASK_SIZE = 1024

export function BeautyRetouchOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef<Uint8Array | null>(null)
  const baseRef = useRef<Uint8Array | null>(null)
  const strokeRef = useRef<Uint8Array | null>(null)
  const draftRef = useRef<Uint8Array | null>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const imageRect = canvas.imageRect
  const manualLayer = edit.pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_MANUAL_RETOUCH_LAYER_ID)
  const maskSize = {
    width: manualLayer?.width ?? DEFAULT_MASK_SIZE,
    height: manualLayer?.height ?? DEFAULT_MASK_SIZE,
  }
  const displaySize = useMemo(() => {
    const aspect = Math.max(0.01, imageRect.width / Math.max(1, imageRect.height))
    return aspect >= 1
      ? { width: 512, height: Math.max(1, Math.round(512 / aspect)) }
      : { width: Math.max(1, Math.round(512 * aspect)), height: 512 }
  }, [imageRect.height, imageRect.width])

  function displayToSource(x: number, y: number): { x: number; y: number } {
    const transform = edit.pipeline.transform
    const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const orientation = ((transform.orientation % 180) + 180) % 180
    const swapsAxes = orientation >= 45 && orientation <= 135
    const frameWidth = swapsAxes ? 1 : canvas.sourceAspect
    const frameHeight = swapsAxes ? canvas.sourceAspect : 1
    let centeredX = (crop.x + x * crop.w - 0.5) * frameWidth / Math.max(transform.scale, 0.0001)
    let centeredY = (crop.y + y * crop.h - 0.5) * frameHeight / Math.max(transform.scale, 0.0001)
    const radians = (transform.orientation + transform.rotate) * Math.PI / 180
    const sourceXBeforeFlip = centeredX * Math.cos(radians) + centeredY * Math.sin(radians)
    const sourceYBeforeFlip = -centeredX * Math.sin(radians) + centeredY * Math.cos(radians)
    centeredX = transform.flipH ? -sourceXBeforeFlip : sourceXBeforeFlip
    centeredY = transform.flipV ? -sourceYBeforeFlip : sourceYBeforeFlip
    return {
      x: centeredX / Math.max(canvas.sourceAspect, 0.0001) + 0.5,
      y: centeredY + 0.5,
    }
  }

  function renderMask(data: Uint8Array, reveal: boolean): void {
    const element = canvasRef.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const preview = buildMaskOverlayPreview(data, maskSize, displaySize, displayToSource, false, 0)
    const image = context.createImageData(displaySize.width, displaySize.height)
    if (reveal) {
      for (let index = 0; index < preview.length; index += 1) {
        const alpha = Math.round(preview[index] * 0.42)
        image.data[index * 4] = 34
        image.data[index * 4 + 1] = 197
        image.data[index * 4 + 2] = 148
        image.data[index * 4 + 3] = alpha
      }
    }
    context.putImageData(image, 0, 0)
  }

  useEffect(() => {
    let cancelled = false
    if (!edit.beautyRetouchActive || !edit.beautyRetouchMode) return
    const load = manualLayer
      ? window.luna.workspace.loadColorMask(media.currentProject?.id ?? '', manualLayer.path)
        .then((loaded) => new Uint8Array(loaded.bytes))
      : Promise.resolve(new Uint8Array(maskSize.width * maskSize.height))
    void load.then((data) => {
      if (cancelled) return
      dataRef.current = data
      renderMask(data, edit.beautyRetouchMode === 'erase')
    }).catch(() => {
      if (!cancelled) toast.error('手动修复区域加载失败')
    })
    return () => { cancelled = true }
    // Rendering follows the current saved mask and transform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit.beautyRetouchActive, edit.beautyRetouchMode, manualLayer?.path, media.currentProject?.id])

  useEffect(() => {
    if (dataRef.current) renderMask(dataRef.current, edit.beautyRetouchMode === 'erase')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySize.height, displaySize.width, edit.beautyRetouchMode, edit.pipeline.transform])

  if (!edit.beautyRetouchActive || !edit.beautyRetouchMode) return null

  const effectiveBrushDiameter = edit.beautyRetouchBrushSize * Math.max(maskSize.width, maskSize.height) / 512
  const cursorDiameter = (() => {
    if (!cursor) return edit.beautyRetouchBrushSize
    const centerX = cursor.x / Math.max(1, imageRect.width)
    const centerY = cursor.y / Math.max(1, imageRect.height)
    const center = displayToSource(centerX, centerY)
    const next = displayToSource(centerX + 1 / Math.max(1, imageRect.width), centerY)
    const sourcePerPixel = Math.max(0.001, Math.hypot(
      (next.x - center.x) * maskSize.width,
      (next.y - center.y) * maskSize.height,
    ))
    return Math.max(2, effectiveBrushDiameter / sourcePerPixel)
  })()

  function pointForEvent(event: PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    const source = displayToSource(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    )
    return {
      x: Math.max(0, Math.min(maskSize.width - 1, source.x * maskSize.width)),
      y: Math.max(0, Math.min(maskSize.height - 1, source.y * maskSize.height)),
    }
  }

  function paint(event: PointerEvent<HTMLCanvasElement>): void {
    const base = baseRef.current
    const stroke = strokeRef.current
    if (!base || !stroke || saving) return
    const point = pointForEvent(event)
    const previous = lastPointRef.current ?? point
    const radius = effectiveBrushDiameter / 2
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.3)))
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps
      drawMaskBrush(
        stroke,
        maskSize.width,
        maskSize.height,
        previous.x + (point.x - previous.x) * ratio,
        previous.y + (point.y - previous.y) * ratio,
        radius,
        0.65,
      )
    }
    lastPointRef.current = point
    const operation = edit.beautyRetouchMode === 'erase' ? 'subtract' : 'add'
    const draft = applyMaskSelectionOperation(base, stroke, operation)
    draftRef.current = draft
    renderMask(draft, true)
  }

  async function saveStroke(data: Uint8Array): Promise<void> {
    const projectId = media.currentProject?.id
    const assetId = media.currentProject?.assets[media.activeIndex]?.id
    if (!projectId || !assetId) return
    setSaving(true)
    try {
      const saved = await window.luna.workspace.saveColorMask(
        projectId,
        assetId,
        maskSize.width,
        maskSize.height,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        0,
      )
      const layer = createManualBeautyRetouchLayer(saved, manualLayer)
      edit.commitPatch({
        beautyMasks: [
          layer,
          ...edit.pipeline.beautyMasks.filter((item) => item.id !== BEAUTY_MANUAL_RETOUCH_LAYER_ID),
        ],
      })
      dataRef.current = new Uint8Array(data)
      renderMask(data, edit.beautyRetouchMode === 'erase')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '手动修复保存失败')
      if (dataRef.current) renderMask(dataRef.current, edit.beautyRetouchMode === 'erase')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="beauty-retouch-overlay-shell"
      style={{ left: imageRect.x, top: imageRect.y, width: imageRect.width, height: imageRect.height }}
    >
      <canvas
        ref={canvasRef}
        className="beauty-retouch-overlay"
        width={displaySize.width}
        height={displaySize.height}
        aria-label="局部修复画笔"
        onPointerDown={(event) => {
          if (saving || !dataRef.current) return
          event.currentTarget.setPointerCapture(event.pointerId)
          baseRef.current = new Uint8Array(dataRef.current)
          strokeRef.current = new Uint8Array(maskSize.width * maskSize.height)
          draftRef.current = null
          lastPointRef.current = null
          paint(event)
        }}
        onPointerMove={(event) => {
          setCursor({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
          if (event.currentTarget.hasPointerCapture(event.pointerId)) paint(event)
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          const completed = draftRef.current
          baseRef.current = null
          strokeRef.current = null
          draftRef.current = null
          lastPointRef.current = null
          if (completed) void saveStroke(completed)
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          baseRef.current = null
          strokeRef.current = null
          draftRef.current = null
          lastPointRef.current = null
          if (dataRef.current) renderMask(dataRef.current, edit.beautyRetouchMode === 'erase')
        }}
        onPointerLeave={() => setCursor(null)}
      />
      {cursor && (
        <span
          className={`beauty-retouch-cursor${edit.beautyRetouchMode === 'erase' ? ' is-erase' : ''}`}
          style={{ left: cursor.x, top: cursor.y, width: cursorDiameter, height: cursorDiameter }}
        />
      )}
    </div>
  )
}
