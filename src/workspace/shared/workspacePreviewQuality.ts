import type { WorkspacePreviewQuality } from '../../shared/types/settings'

const PREVIEW_MAX_SIDE: Record<WorkspacePreviewQuality, number> = {
  smooth: 960,
  balanced: 1440,
  high: 2160,
  original: 3840,
}

export function normalizeWorkspacePreviewQuality(value: unknown): WorkspacePreviewQuality {
  return value === 'smooth' || value === 'high' || value === 'original' ? value : 'balanced'
}

export function workspacePreviewMaxSide(quality: WorkspacePreviewQuality): number {
  return PREVIEW_MAX_SIDE[quality]
}
