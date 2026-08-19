import type { WorkspaceOnlyYourColorState, WorkspaceProject } from '../../../shared/types'

export const DEFAULT_ONLY_YOUR_COLOR_INTENSITY = 100
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE = 0
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE = 0
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_BRIGHTNESS = 0
export const DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_CONTRAST = 0
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION = 0
export const DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE = 0

export function onlyYourColorStateForAsset(
  project: WorkspaceProject | null | undefined,
  assetId: string | undefined,
): WorkspaceOnlyYourColorState | undefined {
  if (!assetId) return undefined
  const perAsset = project?.creative?.onlyYourColorByAssetId?.[assetId]
  if (perAsset) return sanitizeOnlyYourColorState(project, perAsset, assetId)
  const legacy = project?.creative?.onlyYourColor
  return legacy?.maskAssetId === assetId ? sanitizeOnlyYourColorState(project, legacy, assetId) : undefined
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/, '')
}

function isMaskPathInProject(project: WorkspaceProject | null | undefined, maskPath: string): boolean {
  if (!project?.dir) return true
  const projectMasksDir = `${normalizePath(project.dir)}/masks/`
  return normalizePath(maskPath).startsWith(projectMasksDir)
}

function sanitizeOnlyYourColorState(
  project: WorkspaceProject | null | undefined,
  state: WorkspaceOnlyYourColorState,
  assetId: string,
): WorkspaceOnlyYourColorState | undefined {
  if (state.maskAssetId && state.maskAssetId !== assetId) return undefined
  if (state.maskProjectId && state.maskProjectId !== project?.id) {
    return { ...state, maskPath: undefined, maskAssetId: undefined }
  }
  if (state.maskPath && !isMaskPathInProject(project, state.maskPath)) {
    return { ...state, maskPath: undefined, maskAssetId: undefined }
  }
  return state
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
