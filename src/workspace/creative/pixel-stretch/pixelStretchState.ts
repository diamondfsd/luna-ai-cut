import type { WorkspacePixelStretchState, WorkspaceProject } from '../../../shared/types'
import type { PixelStretchFlowShape, PixelStretchPathPoint } from '../../../shared/types/workspace'

export const DEFAULT_PIXEL_STRETCH_PRESET = 'right' as const
export const DEFAULT_PIXEL_STRETCH_SUBJECT_MODEL = 'fast' as const
export const DEFAULT_PIXEL_STRETCH_ANGLE = 0
export const DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION = 50
export const DEFAULT_PIXEL_STRETCH_RANGE_START = 28
export const DEFAULT_PIXEL_STRETCH_RANGE_END = 72
export const DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET = 0
export const DEFAULT_PIXEL_STRETCH_FLOW_SHAPE: PixelStretchFlowShape = 'straight'
export const DEFAULT_PIXEL_STRETCH_FLOW_LENGTH = 95
export const DEFAULT_PIXEL_STRETCH_FLOW_CURVE = 55
export const DEFAULT_PIXEL_STRETCH_FLOW_WIDTH = 108
export const DEFAULT_PIXEL_STRETCH_FLOW_END_WIDTH = 18

export function normalizePixelStretchPreset(value: unknown): WorkspacePixelStretchState['preset'] {
  if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'horizontal' || value === 'vertical') return value
  if (value === 'horizon') return 'right'
  return value === 'burst' ? 'horizontal' : DEFAULT_PIXEL_STRETCH_PRESET
}

export function normalizePixelStretchSubjectModel(value: unknown): NonNullable<WorkspacePixelStretchState['subjectModel']> {
  return value === 'fast' || value === 'precise' ? value : DEFAULT_PIXEL_STRETCH_SUBJECT_MODEL
}

export function normalizePixelStretchPercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

export function normalizePixelStretchOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET
}

export function normalizePixelStretchFlowShape(value: unknown): PixelStretchFlowShape {
  return value === 'straight' || value === 'arc' || value === 'cape' || value === 's-curve' || value === 'custom'
    ? value
    : DEFAULT_PIXEL_STRETCH_FLOW_SHAPE
}

export function normalizePixelStretchFlowValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(150, value)) : fallback
}

export function normalizePixelStretchPathPoints(value: unknown): PixelStretchPathPoint[] | undefined {
  if (!Array.isArray(value) || value.length !== 7) return undefined
  const points = value.map((point) => {
    if (!point || typeof point !== 'object') return null
    const { x, y } = point as Partial<PixelStretchPathPoint>
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return null
    return { x: Math.max(-1, Math.min(2, x)), y: Math.max(-1, Math.min(2, y)) }
  })
  return points.every((point): point is PixelStretchPathPoint => point !== null) ? points : undefined
}

export function pixelStretchStateForAsset(project: WorkspaceProject | null | undefined, assetId: string | undefined): WorkspacePixelStretchState | undefined {
  if (!project || !assetId) return undefined
  const mapped = project.creative?.pixelStretchByAssetId?.[assetId]
  if (mapped) return mapped
  const legacy = project.creative?.pixelStretch
  return legacy?.maskAssetId === assetId ? legacy : undefined
}
