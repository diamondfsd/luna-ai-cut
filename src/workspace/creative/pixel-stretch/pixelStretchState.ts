import type { WorkspacePixelStretchState, WorkspaceProject } from '../../../shared/types'

export const DEFAULT_PIXEL_STRETCH_PRESET = 'horizontal' as const
export const DEFAULT_PIXEL_STRETCH_SUBJECT_MODEL = 'precise' as const
export const DEFAULT_PIXEL_STRETCH_ANGLE = 0
export const DEFAULT_PIXEL_STRETCH_SAMPLE_POSITION = 50
export const DEFAULT_PIXEL_STRETCH_RANGE_START = 0
export const DEFAULT_PIXEL_STRETCH_RANGE_END = 100
export const DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET = 0

export function normalizePixelStretchPreset(value: unknown): WorkspacePixelStretchState['preset'] {
  if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'horizontal' || value === 'vertical') return value
  if (value === 'horizon') return 'right'
  return value === 'burst' ? 'horizontal' : DEFAULT_PIXEL_STRETCH_PRESET
}

export function normalizePixelStretchSubjectModel(value: unknown): NonNullable<WorkspacePixelStretchState['subjectModel']> {
  return value === 'fast' ? 'fast' : DEFAULT_PIXEL_STRETCH_SUBJECT_MODEL
}

export function normalizePixelStretchPercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
}

export function normalizePixelStretchOffset(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : DEFAULT_PIXEL_STRETCH_CONTROL_OFFSET
}

export function pixelStretchStateForAsset(project: WorkspaceProject | null | undefined, assetId: string | undefined): WorkspacePixelStretchState | undefined {
  if (!project || !assetId) return undefined
  const mapped = project.creative?.pixelStretchByAssetId?.[assetId]
  if (mapped) return mapped
  const legacy = project.creative?.pixelStretch
  return legacy?.maskAssetId === assetId ? legacy : undefined
}
