import type { WorkspaceOnlyYourColorState, WorkspaceProject } from '../../../shared/types'

export const DEFAULT_ONLY_YOUR_COLOR_INTENSITY = 100
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE = 0.2
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE = 0
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_BRIGHTNESS = -20
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_CONTRAST = 15
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION = 15
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE = 15

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

export function normalizeOnlyYourColorBackgroundExposure(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-5, Math.min(5, numeric)) : DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE
}

export function normalizeOnlyYourColorSubjectExposure(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-5, Math.min(5, numeric)) : DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE
}

export function normalizeOnlyYourColorBackgroundBrightness(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_BRIGHTNESS
}

export function normalizeOnlyYourColorBackgroundContrast(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_CONTRAST
}

export function normalizeOnlyYourColorSubjectSaturation(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION
}

export function normalizeOnlyYourColorSubjectVibrance(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(-100, Math.min(100, numeric)) : DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE
}
