import type { PixelFlowSubjectDirection, WorkspacePixelFlowState, WorkspaceProject } from '../../../shared/types'
import { PIXEL_FLOW_SETTINGS_VERSION } from './pixelFlowPresets'

type NumericPixelFlowKey = 'duration' | 'pixelCount' | 'lightWidth' | 'rainSpeed' | 'rainLength'
  | 'flowStrength' | 'subjectDelay' | 'bloomStrength' | 'filterStrength' | 'colorTransition'
  | 'initialSaturation' | 'initialBrightness'

export function savedPixelFlowParameter(
  saved: WorkspacePixelFlowState | undefined,
  key: NumericPixelFlowKey,
  fallback: number,
): number {
  if (saved?.settingsVersion !== PIXEL_FLOW_SETTINGS_VERSION) return fallback
  return saved[key] ?? fallback
}

export function savedPixelFlowSubjectDirection(
  saved: WorkspacePixelFlowState | undefined,
  fallback: PixelFlowSubjectDirection,
): PixelFlowSubjectDirection {
  if (saved?.settingsVersion !== PIXEL_FLOW_SETTINGS_VERSION) return fallback
  return saved.subjectDirection ?? fallback
}

export function pixelFlowStateForAsset(
  project: WorkspaceProject | null,
  assetId?: string,
): WorkspacePixelFlowState | undefined {
  if (!project || !assetId) return undefined
  const mapped = project.creative?.pixelFlowByAssetId?.[assetId]
  if (mapped) return mapped
  const legacy = project.creative?.pixelFlow
  return legacy?.maskAssetId === assetId ? legacy : undefined
}
