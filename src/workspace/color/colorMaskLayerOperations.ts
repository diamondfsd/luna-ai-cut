import type { ColorMaskLayer } from '../shared/editPipeline'

export type ColorMaskDropPosition = 'before' | 'after'

export function normalizeColorMaskName(value: string, fallback: string): string {
  const normalized = Array.from(value.trim()).slice(0, 40).join('')
  return normalized || fallback
}

export function mergeCompletedColorMaskLayer(
  layers: ColorMaskLayer[],
  targetId: string | null,
  completed: ColorMaskLayer,
): ColorMaskLayer[] {
  if (!targetId) return [...layers, completed]
  const targetIndex = layers.findIndex((layer) => layer.id === targetId)
  if (targetIndex < 0) return layers
  const current = layers[targetIndex]
  const merged: ColorMaskLayer = {
    ...completed,
    id: current.id,
    name: current.name,
    enabled: current.enabled,
    opacity: current.opacity,
    inverted: current.inverted,
    feather: current.feather,
    blendMode: current.blendMode,
    color: current.color,
  }
  const next = [...layers]
  next[targetIndex] = merged
  return next
}

export function reorderColorMaskLayers(
  layers: ColorMaskLayer[],
  draggedId: string,
  targetId: string,
  position: ColorMaskDropPosition,
): ColorMaskLayer[] {
  if (draggedId === targetId) return layers
  const dragged = layers.find((layer) => layer.id === draggedId)
  if (!dragged) return layers
  const remaining = layers.filter((layer) => layer.id !== draggedId)
  const targetIndex = remaining.findIndex((layer) => layer.id === targetId)
  if (targetIndex < 0) return layers
  const next = [...remaining]
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, dragged)
  return next.every((layer, index) => layer.id === layers[index]?.id) ? layers : next
}

export function moveColorMaskLayer(
  layers: ColorMaskLayer[],
  layerId: string,
  direction: -1 | 1,
): ColorMaskLayer[] {
  const current = layers.findIndex((layer) => layer.id === layerId)
  const target = current + direction
  if (current < 0 || target < 0 || target >= layers.length) return layers
  const next = [...layers]
  ;[next[current], next[target]] = [next[target], next[current]]
  return next
}
