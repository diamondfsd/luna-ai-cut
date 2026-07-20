import { clampNumber } from './editParameterRanges'
import type { ColorMaskComponent, ColorMaskComponentOperation } from './colorMaskTypes'

export function normalizeColorMaskComponent(input: ColorMaskComponent): ColorMaskComponent | null {
  if (!input || typeof input !== 'object' || typeof input.id !== 'string' || !input.id) return null
  const operation: ColorMaskComponentOperation = input.operation === 'add' || input.operation === 'subtract' || input.operation === 'intersect'
    ? input.operation
    : 'replace'
  const common = {
    id: input.id,
    loadError: input.loadError === 'missing-or-damaged' ? input.loadError : undefined,
    operation,
    enabled: input.loadError ? false : input.enabled !== false,
    inverted: Boolean(input.inverted),
    targetComponentId: typeof input.targetComponentId === 'string' && input.targetComponentId ? input.targetComponentId : undefined,
  }
  if (input.type === 'raster') {
    if (typeof input.path !== 'string' || !input.path) return null
    return {
      ...common,
      type: 'raster',
      path: input.path,
      width: Math.max(1, Math.round(Number(input.width) || 1)),
      height: Math.max(1, Math.round(Number(input.height) || 1)),
    }
  }
  if (input.type === 'linear-gradient') {
    return {
      ...common,
      type: input.type,
      startX: clampNumber(Number(input.startX), { min: -2, max: 3 }),
      startY: clampNumber(Number(input.startY), { min: -2, max: 3 }),
      endX: clampNumber(Number(input.endX), { min: -2, max: 3 }),
      endY: clampNumber(Number(input.endY), { min: -2, max: 3 }),
    }
  }
  if (input.type !== 'rectangle' && input.type !== 'ellipse' && input.type !== 'radial-gradient') return null
  return {
    ...common,
    type: input.type,
    centerX: clampNumber(Number(input.centerX), { min: -2, max: 3 }),
    centerY: clampNumber(Number(input.centerY), { min: -2, max: 3 }),
    width: clampNumber(Number(input.width), { min: 0.0001, max: 5 }),
    height: clampNumber(Number(input.height), { min: 0.0001, max: 5 }),
    rotation: ((Number(input.rotation) || 0) % 360 + 360) % 360,
    feather: clampNumber(Number(input.feather), { min: 0, max: 1 }),
  }
}
