import type { PixelStretchFlowShape, PixelStretchPathPoint, PixelStretchPresetId } from '../../../shared/types/workspace'
import type { SubjectBounds } from './pixelStretchLayers'

interface BuildFlowPathOptions {
  shape: PixelStretchFlowShape
  preset: PixelStretchPresetId
  length: number
  curve: number
  aspect: number
  bounds: SubjectBounds
  start?: PixelStretchPathPoint
  startInset?: number
  customPoints?: PixelStretchPathPoint[]
}

interface Vector { x: number; y: number }

const KAPPA = 0.5522847498

function add(point: PixelStretchPathPoint, vector: Vector, scale = 1): PixelStretchPathPoint {
  return { x: point.x + vector.x * scale, y: point.y + vector.y * scale }
}

function directionForPreset(preset: PixelStretchPresetId, aspect: number): { direction: Vector; normal: Vector } {
  if (preset === 'left') return { direction: { x: -1 / aspect, y: 0 }, normal: { x: 0, y: 1 } }
  if (preset === 'top') return { direction: { x: 0, y: -1 }, normal: { x: -1 / aspect, y: 0 } }
  if (preset === 'bottom' || preset === 'vertical') return { direction: { x: 0, y: 1 }, normal: { x: -1 / aspect, y: 0 } }
  return { direction: { x: 1 / aspect, y: 0 }, normal: { x: 0, y: 1 } }
}

export function buildPixelStretchFlowPath(options: BuildFlowPathOptions): PixelStretchPathPoint[] | undefined {
  if (options.shape === 'straight') return undefined
  if (options.shape === 'custom' && options.customPoints?.length === 7) return options.customPoints
  const aspect = Math.max(0.0001, options.aspect)
  const { direction, normal } = directionForPreset(options.preset, aspect)
  const sampleCenter = options.start ?? {
    x: options.bounds.x + options.bounds.w / 2,
    y: options.bounds.y + options.bounds.h / 2,
  }
  const start = add(sampleCenter, direction, options.startInset ?? 0)
  const distance = Math.max(0.08, options.length / 100)
  const bend = options.curve / 100

  if (options.shape === 'arc') {
    const radius = distance * 0.5
    const mid = add(add(start, normal, radius * bend), direction, radius)
    const end = add(start, normal, radius * 2 * bend)
    return [
      start,
      add(start, direction, KAPPA * radius),
      add(mid, normal, -KAPPA * radius * bend),
      mid,
      add(mid, normal, KAPPA * radius * bend),
      add(end, direction, KAPPA * radius),
      end,
    ]
  }

  if (options.shape === 'cape') {
    const join = add(add(start, direction, distance * 0.46), normal, distance * 0.12 * bend)
    const end = add(add(start, direction, distance), normal, distance * 0.42 * bend)
    return [
      start,
      add(start, direction, distance * 0.18),
      add(join, direction, -distance * 0.18),
      join,
      add(join, direction, distance * 0.18),
      add(add(end, direction, -distance * 0.24), normal, -distance * 0.12 * bend),
      end,
    ]
  }

  const join = add(add(start, direction, distance * 0.48), normal, distance * 0.26 * bend)
  const end = add(add(start, direction, distance), normal, -distance * 0.24 * bend)
  return [
    start,
    add(start, direction, distance * 0.16),
    add(join, direction, -distance * 0.18),
    join,
    add(join, direction, distance * 0.18),
    add(end, direction, -distance * 0.16),
    end,
  ]
}

export function flattenPixelStretchPath(points: PixelStretchPathPoint[] | undefined): number[] | undefined {
  return points?.length === 7 ? points.flatMap((point) => [point.x, point.y]) : undefined
}
