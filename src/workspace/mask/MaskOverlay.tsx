import { useEffect, useRef, useState } from 'react'
import { DEFAULT_POINT_SEGMENTATION_MODEL_ID } from '../../shared/segmentationModels'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import type { ColorMaskComponent, ColorMaskComponentOperation } from '../shared/editPipeline'
import { componentControlHandles, componentOutline, hitTestComponentControl, updateComponentFromDrag, type MaskComponentDragKind } from './maskComponentControls'
import { applyComponentDraft, drawMaskBrush } from './maskManualRasterization'
import { composeMaskComponents, rasterizeVectorComponent } from './maskComponentRasterization'
import { featherMaskPreview, sampleMaskBilinear } from './maskPreviewSampling'
import { applyMaskSelectionOperation, type MaskSelectionOperation } from './maskSelectionOperations'
import { shapeBoundsFromDrag } from './maskShapeRasterization'
import './MaskOverlay.css'
export function MaskOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draftRef = useRef<Uint8Array | null>(null)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const replacePendingRef = useRef(true)
  const shapeStartRef = useRef<{ x: number; y: number } | null>(null)
  const shapeBaseRef = useRef<Uint8Array | null>(null)
  const componentDraftRef = useRef<ColorMaskComponent | null>(null)
  const strokeDataRef = useRef<Uint8Array | null>(null)
  const strokeOperationRef = useRef<MaskSelectionOperation>('add')
  const componentDragRef = useRef<{
    kind: MaskComponentDragKind
    start: { x: number; y: number }
    original: Exclude<ColorMaskComponent, { type: 'raster' }>
  } | null>(null)
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null)
  const [temporarySubtract, setTemporarySubtract] = useState(false)
  const [componentRasterData, setComponentRasterData] = useState<Map<string, Uint8Array>>(new Map())
  useEffect(() => {
    draftRef.current = mask.maskData ? new Uint8Array(mask.maskData) : null
  }, [mask.maskData])
  useEffect(() => {
    replacePendingRef.current = mask.selectionOperation === 'replace'
  }, [mask.activeMask?.id, mask.selectionOperation])
  useEffect(() => {
    if (mask.manualTool !== 'brush') {
      setTemporarySubtract(false)
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setTemporarySubtract(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setTemporarySubtract(false)
    }
    const clearModifier = () => setTemporarySubtract(false)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', clearModifier)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', clearModifier)
    }
  }, [mask.manualTool])
  useEffect(() => {
    let canceled = false
    const rasterComponents = (mask.activeMask?.components ?? []).filter((component): component is Extract<ColorMaskComponent, { type: 'raster' }> => component.type === 'raster')
    if (!mask.projectId || rasterComponents.length === 0) {
      setComponentRasterData(new Map())
      return
    }
    Promise.all(rasterComponents.map(async (component) => {
      const loaded = await window.luna.workspace.loadColorMask(mask.projectId!, component.path)
      return [component.id, new Uint8Array(loaded.bytes)] as const
    })).then((entries) => {
      if (!canceled) setComponentRasterData(new Map(entries))
    }).catch(() => {
      if (!canceled) setComponentRasterData(new Map())
    })
    return () => { canceled = true }
  }, [mask.activeMask?.components, mask.projectId])
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
  function sourceToDisplay(x: number, y: number): { x: number; y: number } {
    const transform = edit.pipeline.transform
    const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const orientation = ((transform.orientation % 180) + 180) % 180
    const swapsAxes = orientation >= 45 && orientation <= 135
    const frameWidth = swapsAxes ? 1 : canvas.sourceAspect
    const frameHeight = swapsAxes ? canvas.sourceAspect : 1
    let sourceX = (x - 0.5) * canvas.sourceAspect
    let sourceY = y - 0.5
    if (transform.flipH) sourceX = -sourceX
    if (transform.flipV) sourceY = -sourceY
    const radians = (transform.orientation + transform.rotate) * Math.PI / 180
    const centeredX = (sourceX * Math.cos(radians) - sourceY * Math.sin(radians)) * transform.scale
    const centeredY = (sourceX * Math.sin(radians) + sourceY * Math.cos(radians)) * transform.scale
    return {
      x: ((centeredX / frameWidth + 0.5 - crop.x) / crop.w) * displaySize.width,
      y: ((centeredY / frameHeight + 0.5 - crop.y) / crop.h) * displaySize.height,
    }
  }
  function drawActiveComponentControls(context: CanvasRenderingContext2D): void {
    const component = componentDraftRef.current ?? mask.activeComponent
    if (!component || component.type === 'raster' || mask.manualTool !== 'move') return
    const outline = componentOutline(component).map((point) => sourceToDisplay(point.x, point.y))
    context.save()
    context.strokeStyle = '#ffffff'
    context.lineWidth = 1.5
    context.setLineDash([5, 4])
    context.shadowColor = 'rgba(0, 0, 0, 0.9)'
    context.shadowBlur = 2
    context.beginPath()
    outline.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y))
    context.stroke()
    context.setLineDash([])
    for (const handle of componentControlHandles(component)) {
      const point = sourceToDisplay(handle.x, handle.y)
      context.beginPath()
      context.arc(point.x, point.y, handle.kind === 'move' ? 4 : 5, 0, Math.PI * 2)
      context.fillStyle = handle.kind === 'rotate' ? '#0066cc' : '#ffffff'
      context.fill()
      context.strokeStyle = '#111111'
      context.stroke()
    }
    context.restore()
  }
  function render(data: Uint8Array): void {
    const element = canvasRef.current
    if (!element || !mask.maskSize) return
    const context = element.getContext('2d')
    if (!context) return
    const previewMask = new Float32Array(displaySize.width * displaySize.height)
    const center = displayToSource(0.5, 0.5)
    const stepX = displayToSource(0.5 + 1 / displaySize.width, 0.5)
    const stepY = displayToSource(0.5, 0.5 + 1 / displaySize.height)
    const sourcePixelsPerPreviewPixelX = Math.max(0.0001, Math.hypot(
      (stepX.x - center.x) * mask.maskSize.width,
      (stepX.y - center.y) * mask.maskSize.height,
    ))
    const sourcePixelsPerPreviewPixelY = Math.max(0.0001, Math.hypot(
      (stepY.x - center.x) * mask.maskSize.width,
      (stepY.y - center.y) * mask.maskSize.height,
    ))
    for (let y = 0; y < displaySize.height; y++) {
      for (let x = 0; x < displaySize.width; x++) {
        const source = displayToSource((x + 0.5) / displaySize.width, (y + 0.5) / displaySize.height)
        if (source.x >= 0 && source.x <= 1 && source.y >= 0 && source.y <= 1) {
          const selected = sampleMaskBilinear(
            data,
            mask.maskSize.width,
            mask.maskSize.height,
            source.x,
            source.y,
          )
          previewMask[y * displaySize.width + x] = mask.activeMask?.inverted ? 255 - selected : selected
        }
      }
    }
    const feathered = featherMaskPreview(
      previewMask,
      displaySize.width,
      displaySize.height,
      mask.activeMask?.feather ?? 0,
      sourcePixelsPerPreviewPixelX,
      sourcePixelsPerPreviewPixelY,
    )
    const image = context.createImageData(displaySize.width, displaySize.height)
    for (let y = 0; y < displaySize.height; y++) {
      for (let x = 0; x < displaySize.width; x++) {
        const outputIndex = y * displaySize.width + x
        const alpha = mask.showOverlay ? Math.round(feathered[outputIndex] * 0.55) : 0
        image.data[outputIndex * 4] = 255
        image.data[outputIndex * 4 + 1] = 52
        image.data[outputIndex * 4 + 2] = 76
        image.data[outputIndex * 4 + 3] = alpha
      }
    }
    context.putImageData(image, 0, 0)
    drawActiveComponentControls(context)
  }
  useEffect(() => {
    if (mask.maskData) render(mask.maskData)
    // render depends on the same visual inputs listed here and is intentionally local to this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.sourceAspect, displaySize.height, displaySize.width, edit.pipeline.transform, mask.activeComponent, mask.activeMask?.feather, mask.activeMask?.inverted, mask.manualTool, mask.maskData, mask.maskSize, mask.showOverlay])
  if (!mask.editing || !mask.maskSize) return null
  const imageRect = canvas.imageRect
  const vectorTool = mask.manualTool === 'rectangle' || mask.manualTool === 'ellipse' || mask.manualTool === 'linear-gradient' || mask.manualTool === 'radial-gradient'
    ? mask.manualTool
    : null
  const activeVectorComponent = mask.activeComponent?.type !== 'raster' ? mask.activeComponent : null
  const interactive = mask.manualTool !== 'move' || mask.semanticPicking || Boolean(activeVectorComponent)
  const effectiveBrushSize = mask.brushSize * Math.max(mask.maskSize.width, mask.maskSize.height) / 512
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
    return Math.max(2, effectiveBrushSize / sourcePerPixel)
  })()

  function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect()
    const source = displayToSource((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
    return {
      x: Math.max(0, Math.min(mask.maskSize!.width - 1, source.x * mask.maskSize!.width)),
      y: Math.max(0, Math.min(mask.maskSize!.height - 1, source.y * mask.maskSize!.height)),
    }
  }

  function normalizedPointForEvent(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const point = pointForEvent(event)
    return { x: point.x / mask.maskSize!.width, y: point.y / mask.maskSize!.height }
  }

  function composeComponentDraft(component: Exclude<ColorMaskComponent, { type: 'raster' }>): Uint8Array | null {
    const components = mask.activeMask?.components
    if (!components || !mask.maskSize) return null
    const rasterComponents = components.filter((item) => item.type === 'raster')
    if (rasterComponents.some((item) => !componentRasterData.has(item.id))) return null
    return composeMaskComponents(
      mask.maskSize.width,
      mask.maskSize.height,
      components.map((item) => item.id === component.id ? component : item),
      (item) => componentRasterData.get(item.id) ?? null,
    )
  }

  function updateActiveComponentDrag(event: React.PointerEvent<HTMLCanvasElement>): boolean {
    const drag = componentDragRef.current
    if (!drag) return false
    const component = updateComponentFromDrag(drag.original, drag.kind, drag.start, normalizedPointForEvent(event))
    const data = composeComponentDraft(component)
    if (!data) return false
    componentDraftRef.current = component
    draftRef.current = data
    render(data)
    return true
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>): void {
    const base = shapeBaseRef.current
    const stroke = strokeDataRef.current
    if (mask.busy || !base || !stroke || !mask.maskSize) return
    const point = pointForEvent(event)
    const previous = lastPointRef.current ?? point
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const radius = effectiveBrushSize / 2
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.3)))
    for (let step = 0; step <= steps; step++) {
      const ratio = step / steps
      drawMaskBrush(
        stroke,
        mask.maskSize.width,
        mask.maskSize.height,
        previous.x + (point.x - previous.x) * ratio,
        previous.y + (point.y - previous.y) * ratio,
        radius,
      )
    }
    lastPointRef.current = point
    const data = applyMaskSelectionOperation(base, stroke, strokeOperationRef.current)
    draftRef.current = data
    render(data)
  }

  function updateVectorDraft(event: React.PointerEvent<HTMLCanvasElement>, kind: NonNullable<typeof vectorTool>): boolean {
    const start = shapeStartRef.current
    const base = shapeBaseRef.current
    if (!start || !base || !mask.maskSize) return false
    const current = pointForEvent(event)
    const bounds = shapeBoundsFromDrag(start, current, {
      centered: event.altKey,
      constrained: event.shiftKey,
    })
    const tooSmall = kind === 'linear-gradient'
      ? Math.hypot(current.x - start.x, current.y - start.y) < 0.5
      : bounds.right - bounds.left < 0.5 || bounds.bottom - bounds.top < 0.5
    if (tooSmall) {
      draftRef.current = new Uint8Array(base)
      render(base)
      return false
    }
    const operation: ColorMaskComponentOperation = (kind === 'linear-gradient' || kind === 'radial-gradient') && mask.constrainGradient
      ? 'intersect'
      : mask.selectionOperation
    const common = {
      id: componentDraftRef.current?.id ?? `component-${crypto.randomUUID()}`,
      operation,
      enabled: true,
      inverted: false,
    }
    const component: ColorMaskComponent = kind === 'linear-gradient'
      ? {
          ...common,
          type: 'linear-gradient',
          startX: start.x / mask.maskSize.width,
          startY: start.y / mask.maskSize.height,
          endX: current.x / mask.maskSize.width,
          endY: current.y / mask.maskSize.height,
        }
      : {
          ...common,
          type: kind,
          centerX: (bounds.left + bounds.right) / 2 / mask.maskSize.width,
          centerY: (bounds.top + bounds.bottom) / 2 / mask.maskSize.height,
          width: (bounds.right - bounds.left) / mask.maskSize.width,
          height: (bounds.bottom - bounds.top) / mask.maskSize.height,
          rotation: 0,
          feather: kind === 'radial-gradient' ? 1 : 0,
        }
    componentDraftRef.current = component
    const incoming = rasterizeVectorComponent(mask.maskSize.width, mask.maskSize.height, component)
    const data = applyComponentDraft(base, incoming, operation)
    draftRef.current = data
    render(data)
    return true
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
      style={{ left: imageRect.x, top: imageRect.y, width: imageRect.width, height: imageRect.height, pointerEvents: interactive ? 'auto' : 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="workspace-mask-overlay"
        width={displaySize.width}
        height={displaySize.height}
        style={{
          cursor: mask.busy ? 'wait' : mask.semanticPicking || vectorTool ? 'crosshair' : mask.manualTool === 'brush' ? 'none' : mask.manualTool === 'move' && activeVectorComponent ? 'move' : undefined,
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
            return
          }
          if (mask.manualTool === 'move' && activeVectorComponent) {
            const point = normalizedPointForEvent(event)
            const kind = hitTestComponentControl(activeVectorComponent, point, 14 / Math.max(1, Math.min(imageRect.width, imageRect.height)))
            if (!kind) return
            event.currentTarget.setPointerCapture(event.pointerId)
            componentDragRef.current = { kind, start: point, original: structuredClone(activeVectorComponent) }
            componentDraftRef.current = activeVectorComponent
            return
          }
          if (vectorTool) {
            event.currentTarget.setPointerCapture(event.pointerId)
            shapeStartRef.current = pointForEvent(event)
            shapeBaseRef.current = mask.maskData ? new Uint8Array(mask.maskData) : new Uint8Array(mask.maskSize!.width * mask.maskSize!.height)
            componentDraftRef.current = null
            updateVectorDraft(event, vectorTool)
            return
          }
          if (mask.manualTool !== 'brush') return
          event.currentTarget.setPointerCapture(event.pointerId)
          lastPointRef.current = null
          shapeBaseRef.current = mask.maskData ? new Uint8Array(mask.maskData) : new Uint8Array(mask.maskSize!.width * mask.maskSize!.height)
          strokeDataRef.current = new Uint8Array(mask.maskSize!.width * mask.maskSize!.height)
          if (event.altKey) strokeOperationRef.current = 'subtract'
          else if (mask.selectionOperation === 'replace' && !replacePendingRef.current) strokeOperationRef.current = 'add'
          else strokeOperationRef.current = mask.selectionOperation
          if (mask.selectionOperation === 'replace' && replacePendingRef.current && !event.altKey) {
            replacePendingRef.current = false
          }
          paint(event)
        }}
        onPointerMove={(event) => {
          setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
          if (!mask.busy && event.currentTarget.hasPointerCapture(event.pointerId)) {
            if (componentDragRef.current) updateActiveComponentDrag(event)
            else if (vectorTool) updateVectorDraft(event, vectorTool)
            else paint(event)
          }
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const completedComponentEdit = componentDragRef.current ? updateActiveComponentDrag(event) : true
          const completedShape = vectorTool ? updateVectorDraft(event, vectorTool) : completedComponentEdit
          event.currentTarget.releasePointerCapture(event.pointerId)
          const completedComponent = componentDraftRef.current
          const replacedComponentId = componentDragRef.current?.original.id
          const completedStroke = strokeDataRef.current
          lastPointRef.current = null
          shapeStartRef.current = null
          shapeBaseRef.current = null
          componentDraftRef.current = null
          componentDragRef.current = null
          strokeDataRef.current = null
          if (mask.busy) {
            restoreCommittedMask()
            return
          }
          if (!completedShape) {
            restoreCommittedMask()
            return
          }
          if (draftRef.current) {
            if ((vectorTool || replacedComponentId) && completedComponent) {
              void mask.commitMask(new Uint8Array(draftRef.current), {
                component: completedComponent,
                replaceComponentId: replacedComponentId,
              })
            } else if (completedStroke) {
              void mask.commitMask(new Uint8Array(draftRef.current), {
                component: {
                  id: `component-${crypto.randomUUID()}`,
                  type: 'raster',
                  operation: strokeOperationRef.current,
                  enabled: true,
                  inverted: false,
                  path: '',
                  width: mask.maskSize!.width,
                  height: mask.maskSize!.height,
                },
                rasterData: new Uint8Array(completedStroke),
              })
            }
          }
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          lastPointRef.current = null
          shapeStartRef.current = null
          shapeBaseRef.current = null
          componentDraftRef.current = null
          componentDragRef.current = null
          strokeDataRef.current = null
          setCursorPoint(null)
          if (mask.selectionOperation === 'replace') replacePendingRef.current = true
          restoreCommittedMask()
        }}
      />
      {!mask.busy && mask.manualTool === 'brush' && !mask.semanticPicking && cursorPoint && (
        <span
          className={`workspace-mask-brush-cursor${mask.selectionOperation === 'subtract' || temporarySubtract ? ' is-subtract' : ''}`}
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
