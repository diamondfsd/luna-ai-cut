import { useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_POINT_SEGMENTATION_MODEL_ID } from '../../shared/segmentationModels'
import { useWorkspaceCanvas } from '../context/WorkspaceCanvasContext'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import type { ColorMaskComponent, ColorMaskComponentOperation } from '../shared/editPipeline'
import { drawMaskComponentControls } from './maskComponentControlDrawing'
import { hitTestComponentControl, shouldShowComponentControls, updateComponentFromDrag, type MaskComponentDragKind } from './maskComponentControls'
import { applyComponentDraft, drawMaskBrush } from './maskManualRasterization'
import { composeBaseSelectionComponents, composeMaskComponents, editableMaskComponents, gradientTargetComponent, rasterizeVectorComponent } from './maskComponentRasterization'
import { MaskBrushCursor } from './MaskBrushCursor'
import { MaskSelectionBoundaryCanvas, type MaskSelectionBoundaryHandle } from './MaskSelectionBoundaryCanvas'
import { buildMaskOverlayPreview } from './maskOverlayPreview'
import { applyMaskSelectionOperation, resampleMask, type MaskSelectionOperation } from './maskSelectionOperations'
import { shapeBoundsFromDrag } from './maskShapeRasterization'
import { InstanceStrokeOverlay } from '../removal/InstanceStrokeOverlay'
import './MaskOverlay.css'

const DRAG_PREVIEW_MAX_SIDE = 256

interface MaskRenderSize {
  width: number
  height: number
}

interface MaskRenderOptions {
  dataSize: MaskRenderSize
  outputSize: MaskRenderSize
  boundaryData?: Uint8Array
  updateBoundary?: boolean
}

interface MaskPointerInput {
  clientX: number
  clientY: number
  altKey: boolean
  shiftKey: boolean
}

type MaskVectorTool = 'rectangle' | 'ellipse' | 'linear-gradient' | 'radial-gradient'

function sizeForAspect(aspect: number, maxSide: number): MaskRenderSize {
  return aspect >= 1
    ? { width: maxSide, height: Math.max(1, Math.round(maxSide / aspect)) }
    : { width: Math.max(1, Math.round(maxSide * aspect)), height: maxSide }
}

export function MaskOverlay() {
  const canvas = useWorkspaceCanvas()
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controlsCanvasRef = useRef<HTMLCanvasElement>(null)
  const selectionBoundaryRef = useRef<MaskSelectionBoundaryHandle>(null)
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
  const shapePreviewBaseRef = useRef<Uint8Array | null>(null)
  const pendingDragPreviewRef = useRef<{ kind: 'component' | 'vector'; pointer: MaskPointerInput; vectorTool?: MaskVectorTool } | null>(null)
  const dragPreviewFrameRef = useRef<number | null>(null)
  const [cursorPoint, setCursorPoint] = useState<{ x: number; y: number } | null>(null)
  const [temporarySubtract, setTemporarySubtract] = useState(false)
  const [componentRasterData, setComponentRasterData] = useState<Map<string, Uint8Array>>(new Map())
  const maskComponents = useMemo(() => editableMaskComponents(mask.activeMask), [mask.activeMask])
  const imageRect = canvas.imageRect
  const controlPixelRatio = Math.min(2, window.devicePixelRatio || 1)
  const controlSize = {
    width: Math.max(1, Math.round(imageRect.width * controlPixelRatio)),
    height: Math.max(1, Math.round(imageRect.height * controlPixelRatio)),
  }
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
    const rasterComponents = maskComponents.filter((component): component is Extract<ColorMaskComponent, { type: 'raster' }> => component.type === 'raster')
    if (!mask.projectId || rasterComponents.length === 0) {
      setComponentRasterData(new Map())
      return
    }
    Promise.allSettled(rasterComponents.map(async (component) => {
      const loaded = await window.luna.workspace.loadColorMask(mask.projectId!, component.path)
      return [component.id, new Uint8Array(loaded.bytes)] as const
    })).then((results) => {
      if (canceled) return
      const entries = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      setComponentRasterData(new Map(entries))
    })
    return () => { canceled = true }
  }, [mask.projectId, maskComponents])
  const displaySize = useMemo(() => {
    const aspect = Math.max(0.01, canvas.imageRect.width / Math.max(1, canvas.imageRect.height))
    return sizeForAspect(aspect, 512)
  }, [canvas.imageRect.height, canvas.imageRect.width])
  const dragPreviewSize = useMemo(() => {
    const aspect = Math.max(0.01, canvas.imageRect.width / Math.max(1, canvas.imageRect.height))
    return sizeForAspect(aspect, DRAG_PREVIEW_MAX_SIDE)
  }, [canvas.imageRect.height, canvas.imageRect.width])
  const coordinateMapper = useMemo(() => {
    const transform = edit.pipeline.transform
    const crop = transform.crop ?? { x: 0, y: 0, w: 1, h: 1 }
    const orientation = ((transform.orientation % 180) + 180) % 180
    const swapsAxes = orientation >= 45 && orientation <= 135
    const frameWidth = swapsAxes ? 1 : canvas.sourceAspect
    const frameHeight = swapsAxes ? canvas.sourceAspect : 1
    const sourceAspect = Math.max(canvas.sourceAspect, 0.0001)
    const scale = Math.max(transform.scale, 0.0001)
    const radians = (transform.orientation + transform.rotate) * Math.PI / 180
    const sine = Math.sin(radians)
    const cosine = Math.cos(radians)

    return {
      displayToSource(x: number, y: number): { x: number; y: number } {
        const centeredX = (crop.x + x * crop.w - 0.5) * frameWidth / scale
        const centeredY = (crop.y + y * crop.h - 0.5) * frameHeight / scale
        let sourceX = centeredX * cosine + centeredY * sine
        let sourceY = -centeredX * sine + centeredY * cosine
        if (transform.flipH) sourceX = -sourceX
        if (transform.flipV) sourceY = -sourceY
        return { x: sourceX / sourceAspect + 0.5, y: sourceY + 0.5 }
      },
      sourceToDisplay(x: number, y: number, outputSize: MaskRenderSize): { x: number; y: number } {
        let sourceX = (x - 0.5) * sourceAspect
        let sourceY = y - 0.5
        if (transform.flipH) sourceX = -sourceX
        if (transform.flipV) sourceY = -sourceY
        const centeredX = (sourceX * cosine - sourceY * sine) * scale
        const centeredY = (sourceX * sine + sourceY * cosine) * scale
        return {
          x: ((centeredX / frameWidth + 0.5 - crop.x) / crop.w) * outputSize.width,
          y: ((centeredY / frameHeight + 0.5 - crop.y) / crop.h) * outputSize.height,
        }
      },
    }
  }, [canvas.sourceAspect, edit.pipeline.transform])
  const { displayToSource, sourceToDisplay } = coordinateMapper
  function drawActiveComponentControls(outputSize = controlSize): void {
    const element = controlsCanvasRef.current
    if (!element) return
    if (element.width !== outputSize.width) element.width = outputSize.width
    if (element.height !== outputSize.height) element.height = outputSize.height
    const context = element.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, outputSize.width, outputSize.height)
    const component = componentDraftRef.current ?? mask.activeComponent
    if (!component || component.type === 'raster' || !shouldShowComponentControls(mask.manualTool, Boolean(componentDraftRef.current))) return
    const pixelRatio = (outputSize.width / Math.max(1, imageRect.width) + outputSize.height / Math.max(1, imageRect.height)) / 2
    drawMaskComponentControls(
      context,
      component,
      (point) => sourceToDisplay(point.x, point.y, outputSize),
      pixelRatio,
      canvas.sourceAspect,
    )
  }
  function render(data: Uint8Array, shimmerOffset = 0, options?: MaskRenderOptions): void {
    const element = canvasRef.current
    if (!element || !mask.maskSize) return
    const dataSize = options?.dataSize ?? mask.maskSize
    const outputSize = options?.outputSize ?? displaySize
    if (element.width !== outputSize.width) element.width = outputSize.width
    if (element.height !== outputSize.height) element.height = outputSize.height
    const context = element.getContext('2d')
    if (!context) return
    const layerFeather = maskComponents.some((component) => component.type !== 'raster') ? 0 : mask.activeMask?.feather ?? 0
    const feathered = buildMaskOverlayPreview(data, dataSize, outputSize, displayToSource, Boolean(mask.activeMask?.inverted), layerFeather)
    const image = context.createImageData(outputSize.width, outputSize.height)
    for (let y = 0; y < outputSize.height; y++) {
      for (let x = 0; x < outputSize.width; x++) {
        const outputIndex = y * outputSize.width + x
        const alpha = mask.showOverlay ? Math.round(feathered[outputIndex] * 0.55) : 0
        image.data[outputIndex * 4] = 255
        image.data[outputIndex * 4 + 1] = mask.reconstructing ? 255 : 52
        image.data[outputIndex * 4 + 2] = mask.reconstructing ? 255 : 76
        image.data[outputIndex * 4 + 3] = alpha
      }
    }
    context.putImageData(image, 0, 0)
    if (mask.reconstructing && mask.showOverlay) {
      context.save()
      context.globalCompositeOperation = 'source-in'
      const cycle = Math.max(outputSize.width * 1.8, 1)
      const offset = shimmerOffset % cycle
      const gradient = context.createLinearGradient(offset - cycle, outputSize.height, offset, 0)
      gradient.addColorStop(0, '#22d3ee')
      gradient.addColorStop(0.28, '#3b82f6')
      gradient.addColorStop(0.55, '#ec4899')
      gradient.addColorStop(0.78, '#facc15')
      gradient.addColorStop(1, '#22d3ee')
      context.fillStyle = gradient
      context.fillRect(0, 0, outputSize.width, outputSize.height)
      context.restore()
    }
    const boundaryDataOverride = options?.boundaryData
    if (options?.updateBoundary !== false) {
      const vectorDraft = componentDraftRef.current
      const replacedId = componentDragRef.current?.original.id
      const boundaryComponents = vectorDraft && vectorDraft.type !== 'linear-gradient' && vectorDraft.type !== 'radial-gradient'
        ? replacedId
          ? maskComponents.map((component) => component.id === replacedId ? vectorDraft : component)
          : vectorDraft.operation === 'replace' ? [vectorDraft] : [...maskComponents, vectorDraft]
        : maskComponents
      const missingRaster = boundaryComponents.some((component) => component.enabled && component.type === 'raster' && !componentRasterData.has(component.id))
      let boundaryData = boundaryDataOverride ?? data
      if (!boundaryDataOverride && !missingRaster) {
        boundaryData = composeBaseSelectionComponents(dataSize.width, dataSize.height, boundaryComponents, (component) => componentRasterData.get(component.id) ?? null)
        if (strokeDataRef.current) {
          boundaryData = applyMaskSelectionOperation(boundaryData, strokeDataRef.current, strokeOperationRef.current)
        }
      }
      const boundaryPreview = boundaryData === data ? feathered : buildMaskOverlayPreview(boundaryData, dataSize, outputSize, displayToSource, Boolean(mask.activeMask?.inverted), layerFeather)
      selectionBoundaryRef.current?.show(boundaryPreview, outputSize.width, outputSize.height)
    }
    drawActiveComponentControls(outputSize)
  }
  useEffect(() => {
    if (mask.maskData) render(mask.maskData)
    // render depends on the same visual inputs listed here and is intentionally local to this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.sourceAspect, componentRasterData, controlSize.height, controlSize.width, displaySize.height, displaySize.width, edit.pipeline.transform, mask.activeComponent, mask.activeMask?.feather, mask.activeMask?.inverted, mask.manualTool, mask.maskData, mask.maskSize, mask.reconstructing, mask.showOverlay])
  useEffect(() => {
    if (!mask.reconstructing || !mask.maskData) return
    let frame = 0
    let previous = 0
    const animate = (time: number): void => {
      if (time - previous >= 32) {
        previous = time
        render(mask.maskData!, time * 0.12)
      }
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
    // render is local and follows the same visual dependencies as the static overlay effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask.maskData, mask.reconstructing])
  if (!mask.editing || !mask.maskSize) return null
  const vectorTool = mask.manualTool === 'rectangle' || mask.manualTool === 'ellipse' || mask.manualTool === 'linear-gradient' || mask.manualTool === 'radial-gradient'
    ? mask.manualTool
    : null
  const activeVectorComponent = mask.activeComponent?.type !== 'raster' ? mask.activeComponent : null
  const interactive = !mask.reconstructing && (mask.manualTool !== 'move' || mask.semanticPicking || Boolean(activeVectorComponent))
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
  function pointerInputForEvent(event: React.PointerEvent<HTMLCanvasElement>): MaskPointerInput {
    return { clientX: event.clientX, clientY: event.clientY, altKey: event.altKey, shiftKey: event.shiftKey }
  }
  function normalizedPointForInput(input: MaskPointerInput): { x: number; y: number } {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return displayToSource((input.clientX - rect.left) / rect.width, (input.clientY - rect.top) / rect.height)
  }
  function pointForEvent(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const source = normalizedPointForInput(pointerInputForEvent(event))
    return {
      x: Math.max(0, Math.min(mask.maskSize!.width - 1, source.x * mask.maskSize!.width)),
      y: Math.max(0, Math.min(mask.maskSize!.height - 1, source.y * mask.maskSize!.height)),
    }
  }
  function normalizedPointForEvent(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    return normalizedPointForInput(pointerInputForEvent(event))
  }
  function composeComponentDraft(component: Exclude<ColorMaskComponent, { type: 'raster' }>, dataSize = mask.maskSize!): Uint8Array | null {
    const components = maskComponents
    if (!components.length || !mask.maskSize) return null
    const rasterComponents = components.filter((item) => item.type === 'raster')
    if (rasterComponents.some((item) => !componentRasterData.has(item.id))) return null
    const exists = components.some((item) => item.id === component.id)
    return composeMaskComponents(
      dataSize.width,
      dataSize.height,
      exists ? components.map((item) => item.id === component.id ? component : item) : [...components, component],
      (item) => componentRasterData.get(item.id) ?? null,
    )
  }
  function updateActiveComponentDrag(input: MaskPointerInput, preview = false): boolean {
    const drag = componentDragRef.current
    if (!drag) return false
    const dataSize = preview ? dragPreviewSize : mask.maskSize!
    const component = updateComponentFromDrag(
      drag.original,
      drag.kind,
      drag.start,
      normalizedPointForInput(input),
      canvas.sourceAspect,
    )
    const data = composeComponentDraft(component, dataSize)
    if (!data) return false
    componentDraftRef.current = component
    if (!preview) draftRef.current = data
    const hasGradient = maskComponents.some((item) => item.type === 'linear-gradient' || item.type === 'radial-gradient')
    const boundaryData = !hasGradient && component.type !== 'linear-gradient' && component.type !== 'radial-gradient' ? data : undefined
    render(data, 0, {
      dataSize,
      outputSize: preview ? dragPreviewSize : displaySize,
      boundaryData,
      updateBoundary: !preview,
    })
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
        mask.brushFeather / 100,
      )
    }
    lastPointRef.current = point
    const data = applyMaskSelectionOperation(base, stroke, strokeOperationRef.current)
    draftRef.current = data
    render(data)
  }
  function updateVectorDraft(input: MaskPointerInput, kind: MaskVectorTool, preview = false): boolean {
    const start = shapeStartRef.current
    const base = preview ? shapePreviewBaseRef.current : shapeBaseRef.current
    if (!start || !base || !mask.maskSize) return false
    const dataSize = preview ? dragPreviewSize : mask.maskSize
    const point = normalizedPointForInput(input)
    const current = { x: point.x * mask.maskSize.width, y: point.y * mask.maskSize.height }
    const bounds = shapeBoundsFromDrag(start, current, {
      centered: input.altKey,
      constrained: input.shiftKey,
    })
    const tooSmall = kind === 'linear-gradient'
      ? Math.hypot(current.x - start.x, current.y - start.y) < 0.5
      : bounds.right - bounds.left < 0.5 || bounds.bottom - bounds.top < 0.5
    if (tooSmall) {
      if (!preview) draftRef.current = new Uint8Array(base)
      render(base, 0, { dataSize, outputSize: preview ? dragPreviewSize : displaySize })
      return false
    }
    const isGradient = kind === 'linear-gradient' || kind === 'radial-gradient'
    const targetComponent = isGradient ? gradientTargetComponent(maskComponents, mask.activeComponent) : null
    if (isGradient && !targetComponent) return false
    const operation: ColorMaskComponentOperation = isGradient ? 'intersect' : mask.selectionOperation
    const common = {
      id: componentDraftRef.current?.id ?? `component-${crypto.randomUUID()}`,
      operation,
      enabled: true,
      inverted: false,
      targetComponentId: componentDraftRef.current?.targetComponentId ?? targetComponent?.id,
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
          sourceAspect: canvas.sourceAspect,
          centerX: (bounds.left + bounds.right) / 2 / mask.maskSize.width,
          centerY: (bounds.top + bounds.bottom) / 2 / mask.maskSize.height,
          width: (bounds.right - bounds.left) / mask.maskSize.width,
          height: (bounds.bottom - bounds.top) / mask.maskSize.height,
          rotation: 0,
          feather: 0,
          softness: 0.15,
        }
    componentDraftRef.current = component
    const incoming = rasterizeVectorComponent(dataSize.width, dataSize.height, component)
    const data = isGradient ? composeComponentDraft(component, dataSize) : applyComponentDraft(base, incoming, operation)
    if (!data) return false
    if (!preview) draftRef.current = data
    const hasGradient = maskComponents.some((item) => item.type === 'linear-gradient' || item.type === 'radial-gradient')
    const boundaryData = !hasGradient && !isGradient ? data : undefined
    render(data, 0, {
      dataSize,
      outputSize: preview ? dragPreviewSize : displaySize,
      boundaryData,
      updateBoundary: !preview,
    })
    return true
  }
  function flushDragPreview(): void {
    dragPreviewFrameRef.current = null
    const pending = pendingDragPreviewRef.current
    pendingDragPreviewRef.current = null
    if (!pending || mask.busy || mask.reconstructing) return
    if (pending.kind === 'component') updateActiveComponentDrag(pending.pointer, true)
    else if (pending.vectorTool) updateVectorDraft(pending.pointer, pending.vectorTool, true)
  }
  function scheduleDragPreview(input: MaskPointerInput, vectorTool?: MaskVectorTool): void {
    pendingDragPreviewRef.current = {
      kind: vectorTool ? 'vector' : 'component',
      pointer: input,
      vectorTool,
    }
    if (dragPreviewFrameRef.current !== null) return
    dragPreviewFrameRef.current = requestAnimationFrame(flushDragPreview)
  }
  function cancelDragPreview(): void {
    if (dragPreviewFrameRef.current !== null) cancelAnimationFrame(dragPreviewFrameRef.current)
    dragPreviewFrameRef.current = null
    pendingDragPreviewRef.current = null
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
      data-reconstructing={mask.reconstructing ? 'true' : 'false'}
      style={{ left: imageRect.x, top: imageRect.y, width: imageRect.width, height: imageRect.height, pointerEvents: interactive ? 'auto' : 'none' }}
    >
      <canvas
        ref={canvasRef}
        className="workspace-mask-overlay"
        width={displaySize.width}
        height={displaySize.height}
        style={{
          cursor: mask.busy || mask.reconstructing ? 'wait' : mask.semanticPicking || vectorTool ? 'crosshair' : mask.manualTool === 'brush' ? 'none' : mask.manualTool === 'move' && activeVectorComponent ? 'move' : undefined,
        }}
        onPointerEnter={(event) => setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })}
        onPointerLeave={() => setCursorPoint(null)}
        onPointerDown={(event) => {
          if (mask.busy || mask.reconstructing) return
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
            const kind = hitTestComponentControl(
              activeVectorComponent,
              point,
              14 / Math.max(1, imageRect.height),
              canvas.sourceAspect,
            )
            if (!kind) return
            event.currentTarget.setPointerCapture(event.pointerId)
            selectionBoundaryRef.current?.clear()
            componentDragRef.current = { kind, start: point, original: structuredClone(activeVectorComponent) }
            componentDraftRef.current = activeVectorComponent
            return
          }
          if (vectorTool) {
            event.currentTarget.setPointerCapture(event.pointerId)
            selectionBoundaryRef.current?.clear()
            shapeStartRef.current = pointForEvent(event)
            shapeBaseRef.current = mask.maskData ? new Uint8Array(mask.maskData) : new Uint8Array(mask.maskSize!.width * mask.maskSize!.height)
            shapePreviewBaseRef.current = resampleMask(
              shapeBaseRef.current,
              mask.maskSize!.width,
              mask.maskSize!.height,
              dragPreviewSize.width,
              dragPreviewSize.height,
            )
            componentDraftRef.current = null
            updateVectorDraft(pointerInputForEvent(event), vectorTool, true)
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
          if (!mask.busy && !mask.reconstructing && event.currentTarget.hasPointerCapture(event.pointerId)) {
            if (componentDragRef.current) scheduleDragPreview(pointerInputForEvent(event))
            else if (vectorTool) scheduleDragPreview(pointerInputForEvent(event), vectorTool)
            else {
              setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
              paint(event)
            }
            return
          }
          setCursorPoint({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          cancelDragPreview()
          const pointer = pointerInputForEvent(event)
          const completedComponentEdit = componentDragRef.current ? updateActiveComponentDrag(pointer) : true
          const completedShape = vectorTool ? updateVectorDraft(pointer, vectorTool) : completedComponentEdit
          event.currentTarget.releasePointerCapture(event.pointerId)
          const completedComponent = componentDraftRef.current
          const replacedComponentId = componentDragRef.current?.original.id
          const completedStroke = strokeDataRef.current
          lastPointRef.current = null
          shapeStartRef.current = null
          shapeBaseRef.current = null
          shapePreviewBaseRef.current = null
          componentDraftRef.current = null
          componentDragRef.current = null
          strokeDataRef.current = null
          if (mask.busy || mask.reconstructing) {
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
              }).then(() => mask.setManualTool('move'))
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
          cancelDragPreview()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          lastPointRef.current = null
          shapeStartRef.current = null
          shapeBaseRef.current = null
          shapePreviewBaseRef.current = null
          componentDraftRef.current = null
          componentDragRef.current = null
          strokeDataRef.current = null
          setCursorPoint(null)
          if (mask.selectionOperation === 'replace') replacePendingRef.current = true
          restoreCommittedMask()
        }}
      />
      <MaskSelectionBoundaryCanvas ref={selectionBoundaryRef} width={displaySize.width} height={displaySize.height} />
      <canvas
        ref={controlsCanvasRef}
        className="workspace-mask-component-controls"
        width={controlSize.width}
        height={controlSize.height}
        aria-hidden="true"
      />
      {mask.manualTool === 'instance-stroke' && !mask.semanticPicking && (
        <InstanceStrokeOverlay width={displaySize.width} height={displaySize.height} displayToSource={displayToSource} />
      )}
      {!mask.busy && !mask.reconstructing && mask.manualTool === 'brush' && !mask.semanticPicking && cursorPoint && (
        <MaskBrushCursor x={cursorPoint.x} y={cursorPoint.y} diameter={brushCursorDiameter} subtract={mask.selectionOperation === 'subtract' || temporarySubtract} />
      )}
    </div>
  )
}
