import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import type { PreviewLayer } from '../shared/types'

type LayerRect = Pick<PreviewLayer, 'dstX' | 'dstY' | 'dstW' | 'dstH'>

interface LayerOverride extends LayerRect {
  filePath: string
}

interface DragState {
  pointerId: number
  layerIndex: number
  startX: number
  startY: number
  startRect: LayerRect
}

interface UseImageLayerInteractionOptions {
  layers: PreviewLayer[]
  canvasRef: RefObject<HTMLCanvasElement | null>
  interactiveImageLayerIndexes?: readonly number[]
  onLayersChange?: (layers: PreviewLayer[]) => void
  minImageScale: number
  maxImageScale: number
}

export function useImageLayerInteraction({
  layers,
  canvasRef,
  interactiveImageLayerIndexes,
  onLayersChange,
  minImageScale,
  maxImageScale,
}: UseImageLayerInteractionOptions) {
  const [layerOverrides, setLayerOverrides] = useState<Map<number, LayerOverride>>(() => new Map())
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const baseLayersRef = useRef<Map<number, LayerOverride>>(new Map())
  const interactiveIndexes = useMemo(() => new Set(
    interactiveImageLayerIndexes ?? layers.flatMap((layer, index) => (
      !layer.isVideo && !layer.positioning ? [index] : []
    )),
  ), [interactiveImageLayerIndexes, layers])

  for (const index of interactiveIndexes) {
    const layer = layers[index]
    const base = baseLayersRef.current.get(index)
    if (layer && base?.filePath !== layer.filePath) {
      baseLayersRef.current.set(index, {
        filePath: layer.filePath,
        dstX: layer.dstX,
        dstY: layer.dstY,
        dstW: layer.dstW,
        dstH: layer.dstH,
      })
    }
  }

  const effectiveLayers = useMemo(() => layers.map((layer, index) => {
    const override = layerOverrides.get(index)
    return interactiveIndexes.has(index) && override?.filePath === layer.filePath
      ? { ...layer, ...override }
      : layer
  }), [interactiveIndexes, layerOverrides, layers])

  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    }
  }, [canvasRef])

  const interactiveLayerAt = useCallback((x: number, y: number) => effectiveLayers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer, index }) => (
      interactiveIndexes.has(index) &&
      !layer.isVideo &&
      !layer.positioning &&
      x >= layer.dstX && x <= layer.dstX + layer.dstW &&
      y >= layer.dstY && y <= layer.dstY + layer.dstH
    ))
    .sort((a, b) => (b.layer.zIndex ?? b.index) - (a.layer.zIndex ?? a.index))[0],
  [effectiveLayers, interactiveIndexes])

  const updateLayerRect = useCallback((layerIndex: number, rect: LayerRect) => {
    const layer = effectiveLayers[layerIndex]
    if (!layer) return
    setLayerOverrides((current) => {
      const next = new Map(current)
      next.set(layerIndex, { filePath: layer.filePath, ...rect })
      return next
    })
    onLayersChange?.(effectiveLayers.map((item, index) => (
      index === layerIndex ? { ...item, ...rect } : item
    )))
  }, [effectiveLayers, onLayersChange])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = canvasPoint(event.clientX, event.clientY)
    const hit = point ? interactiveLayerAt(point.x, point.y) : undefined
    if (!point || !hit) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      layerIndex: hit.index,
      startX: point.x,
      startY: point.y,
      startRect: {
        dstX: hit.layer.dstX,
        dstY: hit.layer.dstY,
        dstW: hit.layer.dstW,
        dstH: hit.layer.dstH,
      },
    }
    setDragging(true)
  }, [canvasPoint, interactiveLayerAt])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = canvasPoint(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    updateLayerRect(drag.layerIndex, {
      ...drag.startRect,
      dstX: drag.startRect.dstX + point.x - drag.startX,
      dstY: drag.startRect.dstY + point.y - drag.startY,
    })
  }, [canvasPoint, updateLayerRect])

  const onPointerEnd = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setDragging(false)
  }, [])

  const onWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.clientX, event.clientY)
    const hit = point ? interactiveLayerAt(point.x, point.y) : undefined
    if (!point || !hit) return
    const baseLayer = baseLayersRef.current.get(hit.index)
    if (!baseLayer || baseLayer.dstW <= 0 || baseLayer.dstH <= 0) return
    event.preventDefault()

    const currentScale = hit.layer.dstW / baseLayer.dstW
    const lowerBound = Math.max(0.01, Math.min(minImageScale, maxImageScale))
    const upperBound = Math.max(lowerBound, maxImageScale)
    const nextScale = Math.min(
      upperBound,
      Math.max(lowerBound, currentScale * Math.exp(-event.deltaY * 0.0015)),
    )
    const factor = nextScale / currentScale
    const relativeX = (point.x - hit.layer.dstX) / hit.layer.dstW
    const relativeY = (point.y - hit.layer.dstY) / hit.layer.dstH
    const dstW = hit.layer.dstW * factor
    const dstH = hit.layer.dstH * factor
    updateLayerRect(hit.index, {
      dstX: point.x - relativeX * dstW,
      dstY: point.y - relativeY * dstH,
      dstW,
      dstH,
    })
  }, [canvasPoint, interactiveLayerAt, maxImageScale, minImageScale, updateLayerRect])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event.clientX, event.clientY)
    const hit = point ? interactiveLayerAt(point.x, point.y) : undefined
    const original = hit ? baseLayersRef.current.get(hit.index) : undefined
    if (!hit || !original) return
    updateLayerRect(hit.index, original)
  }, [canvasPoint, interactiveLayerAt, updateLayerRect])

  const interactive = interactiveIndexes.size > 0
  return {
    effectiveLayers,
    interactive,
    dragging,
    onPointerDown: interactive ? onPointerDown : undefined,
    onPointerMove: interactive ? onPointerMove : undefined,
    onPointerEnd: interactive ? onPointerEnd : undefined,
    onWheel: interactive ? onWheel : undefined,
    onDoubleClick: interactive ? onDoubleClick : undefined,
  }
}
