import type { WorkspaceOnlyYourColorState, WorkspaceProject } from '../../../shared/types'

export const DEFAULT_ONLY_YOUR_COLOR_INTENSITY = 100
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION = 0

export function onlyYourColorStateForAsset(
  project: WorkspaceProject | null | undefined,
  assetId: string | undefined,
): WorkspaceOnlyYourColorState | undefined {
  if (!assetId) return undefined
  const perAsset = project?.creative?.onlyYourColorByAssetId?.[assetId]
  if (perAsset) return perAsset
  const legacy = project?.creative?.onlyYourColor
  return legacy?.maskAssetId === assetId ? legacy : undefined
}

export function normalizeOnlyYourColorIntensity(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_INTENSITY
}

export function normalizeOnlyYourColorSubjectSaturation(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION
}
