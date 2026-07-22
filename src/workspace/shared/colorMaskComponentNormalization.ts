import { clampNumber } from './editParameterRanges'
import type { ColorMaskComponent, ColorMaskComponentOperation, ColorMaskDynamicSource } from './colorMaskTypes'

function normalizeBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeDynamicSource(value: unknown): ColorMaskDynamicSource | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const modelId = normalizeBoundedString(input.modelId, 128)
  if (input.kind !== 'segmentation' || !modelId) return undefined
  const frameTime = Number(input.frameTime)
  const classId = Number(input.classId)
  const point = input.point && typeof input.point === 'object'
    ? input.point as Record<string, unknown>
    : undefined
  const pointX = Number(point?.x)
  const pointY = Number(point?.y)
  return {
    kind: 'segmentation',
    modelId,
    frameTime: input.frameTime !== undefined && Number.isFinite(frameTime) ? Math.max(0, frameTime) : undefined,
    targetId: normalizeBoundedString(input.targetId, 128),
    classId: Number.isInteger(classId) ? classId : undefined,
    className: normalizeBoundedString(input.className, 128),
    point: point && Number.isFinite(pointX) && Number.isFinite(pointY)
      ? {
          x: clampNumber(pointX, { min: 0, max: 1 }),
          y: clampNumber(pointY, { min: 0, max: 1 }),
        }
      : undefined,
  }
}

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
      dynamicSource: normalizeDynamicSource(input.dynamicSource),
    }
  }
  if (input.type === 'linear-gradient') {
    return {
      ...common,
      type: input.type,
      startX: normalizeFiniteNumber(input.startX, 0),
      startY: normalizeFiniteNumber(input.startY, 0),
      endX: normalizeFiniteNumber(input.endX, 1),
      endY: normalizeFiniteNumber(input.endY, 1),
    }
  }
  if (input.type !== 'rectangle' && input.type !== 'ellipse' && input.type !== 'radial-gradient') return null
  const width = Math.max(0.0001, normalizeFiniteNumber(input.width, 0.0001))
  const height = Math.max(0.0001, normalizeFiniteNumber(input.height, 0.0001))
  const legacySoftness = input.featherX !== undefined || input.featherY !== undefined
    ? ((Math.max(0, normalizeFiniteNumber(input.featherX, 0)) / (width / 2))
      + (Math.max(0, normalizeFiniteNumber(input.featherY, 0)) / (height / 2))) / 2
    : (() => {
        const distance = Math.max(0, normalizeFiniteNumber(input.feather, 0)) * Math.min(width, height) / 2
        return (distance / (width / 2) + distance / (height / 2)) / 2
      })()
  return {
    ...common,
    type: input.type,
    centerX: normalizeFiniteNumber(input.centerX, 0.5),
    centerY: normalizeFiniteNumber(input.centerY, 0.5),
    width,
    height,
    rotation: ((Number(input.rotation) || 0) % 360 + 360) % 360,
    feather: Math.max(0, normalizeFiniteNumber(input.feather, 0)),
    softness: input.softness === undefined
      ? legacySoftness
      : Math.max(0, normalizeFiniteNumber(input.softness, legacySoftness)),
  }
}
