import type { WorkspaceMediaAsset, WorkspaceOnlyYourColorState } from '../../../shared/types'
import { subjectBoundsFromMask } from '../pixel-stretch/pixelStretchLayers'
import type { OnlyYourColorAutoTone } from './onlyYourColorAutoTone'
import { NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE } from './onlyYourColorAutoTone'
import { refineOnlyYourColorMask } from './onlyYourColorMaskRefinement'
import {
  DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE,
  normalizeOnlyYourColorBackgroundExposure,
  normalizeOnlyYourColorBackgroundBrightness,
  normalizeOnlyYourColorBackgroundContrast,
  normalizeOnlyYourColorIntensity,
  normalizeOnlyYourColorSubjectSaturation,
  normalizeOnlyYourColorSubjectExposure,
  normalizeOnlyYourColorSubjectVibrance,
} from './onlyYourColorState'

interface StoredMask {
  bytes: ArrayBuffer
  width: number
  height: number
}

interface SegmentationResult extends StoredMask {
  requestId: string
}

interface SavedMask {
  path: string
  width: number
  height: number
}

export interface OnlyYourColorBatchMaskApi {
  loadMask: (projectId: string, path: string) => Promise<StoredMask>
  segment: (request: { requestId: string; filePath: string; modelId: 'rmbg-1.4' }) => Promise<SegmentationResult>
  saveMask: (projectId: string, assetId: string, width: number, height: number, bytes: Uint8Array) => Promise<SavedMask>
  calculateAutoTone?: (filePath: string, mask: Uint8Array, width: number, height: number) => Promise<OnlyYourColorAutoTone>
}

export interface ResolvedOnlyYourColorBatchMask {
  data: Uint8Array
  width: number
  height: number
  state: WorkspaceOnlyYourColorState
  newlyRecognized: boolean
}

function normalizedRecognizedState(
  state: WorkspaceOnlyYourColorState,
  assetId: string,
  maskPath: string,
): WorkspaceOnlyYourColorState {
  return {
    intensity: normalizeOnlyYourColorIntensity(state.intensity),
    subjectExposure: normalizeOnlyYourColorSubjectExposure(state.subjectExposure),
    backgroundExposure: normalizeOnlyYourColorBackgroundExposure(state.backgroundExposure),
    backgroundBrightness: normalizeOnlyYourColorBackgroundBrightness(state.backgroundBrightness),
    backgroundContrast: normalizeOnlyYourColorBackgroundContrast(state.backgroundContrast),
    subjectSaturation: normalizeOnlyYourColorSubjectSaturation(state.subjectSaturation),
    subjectVibrance: normalizeOnlyYourColorSubjectVibrance(state.subjectVibrance),
    subjectModel: state.subjectModel ?? 'fast',
    maskPath,
    maskAssetId: assetId,
  }
}

function defaultRecognizedState(assetId: string, maskPath: string, autoTone: OnlyYourColorAutoTone): WorkspaceOnlyYourColorState {
  return {
    intensity: DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
    subjectExposure: DEFAULT_ONLY_YOUR_COLOR_SUBJECT_EXPOSURE,
    backgroundExposure: normalizeOnlyYourColorBackgroundExposure(autoTone.backgroundExposure),
    backgroundBrightness: normalizeOnlyYourColorBackgroundBrightness(autoTone.backgroundBrightness),
    backgroundContrast: normalizeOnlyYourColorBackgroundContrast(autoTone.backgroundContrast),
    subjectSaturation: DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION,
    subjectVibrance: DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE,
    subjectModel: 'fast',
    maskPath,
    maskAssetId: assetId,
  }
}

export async function resolveOnlyYourColorBatchMask(options: {
  projectId: string
  asset: WorkspaceMediaAsset
  savedState?: WorkspaceOnlyYourColorState
  api: OnlyYourColorBatchMaskApi
}): Promise<ResolvedOnlyYourColorBatchMask> {
  const { projectId, asset, savedState, api } = options
  if (savedState?.maskPath && (!savedState.maskAssetId || savedState.maskAssetId === asset.id)) {
    try {
      const loaded = await api.loadMask(projectId, savedState.maskPath)
      const data = new Uint8Array(loaded.bytes)
      if (subjectBoundsFromMask(data, loaded.width, loaded.height)) {
        return {
          data,
          width: loaded.width,
          height: loaded.height,
          state: normalizedRecognizedState(savedState, asset.id, savedState.maskPath),
          newlyRecognized: false,
        }
      }
    } catch {
      // Missing or damaged saved masks fall through to automatic recognition.
    }
  }

  const requestId = crypto.randomUUID()
  const result = await api.segment({ requestId, filePath: asset.path, modelId: 'rmbg-1.4' })
  const data = refineOnlyYourColorMask(new Uint8Array(result.bytes), result.width, result.height)
  if (!subjectBoundsFromMask(data, result.width, result.height)) {
    throw new Error(`「${asset.name}」未识别到主体`)
  }
  const saved = await api.saveMask(projectId, asset.id, result.width, result.height, data)
  const autoTone = await api.calculateAutoTone?.(asset.path, data, result.width, result.height)
    .catch(() => NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE)
    ?? NEUTRAL_ONLY_YOUR_COLOR_AUTO_TONE
  return {
    data,
    width: saved.width,
    height: saved.height,
    state: defaultRecognizedState(asset.id, saved.path, autoTone),
    newlyRecognized: true,
  }
}
