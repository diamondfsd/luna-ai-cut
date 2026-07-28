import type { WorkspaceMediaAsset, WorkspaceOnlyYourColorState } from '../../../shared/types'
import { erodeMaskOnePixel, subjectBoundsFromMask } from '../pixel-stretch/pixelStretchLayers'
import {
  DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE,
  DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_SATURATION,
  DEFAULT_ONLY_YOUR_COLOR_SUBJECT_VIBRANCE,
  normalizeOnlyYourColorBackgroundExposure,
  normalizeOnlyYourColorIntensity,
  normalizeOnlyYourColorSubjectSaturation,
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
    backgroundExposure: normalizeOnlyYourColorBackgroundExposure(state.backgroundExposure),
    subjectSaturation: normalizeOnlyYourColorSubjectSaturation(state.subjectSaturation),
    subjectVibrance: normalizeOnlyYourColorSubjectVibrance(state.subjectVibrance),
    subjectModel: state.subjectModel ?? 'fast',
    maskPath,
    maskAssetId: assetId,
  }
}

function defaultRecognizedState(assetId: string, maskPath: string): WorkspaceOnlyYourColorState {
  return {
    intensity: DEFAULT_ONLY_YOUR_COLOR_INTENSITY,
    backgroundExposure: DEFAULT_ONLY_YOUR_COLOR_BACKGROUND_EXPOSURE,
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
  const data = erodeMaskOnePixel(new Uint8Array(result.bytes), result.width, result.height)
  if (!subjectBoundsFromMask(data, result.width, result.height)) {
    throw new Error(`「${asset.name}」未识别到主体`)
  }
  const saved = await api.saveMask(projectId, asset.id, result.width, result.height, data)
  return {
    data,
    width: saved.width,
    height: saved.height,
    state: defaultRecognizedState(asset.id, saved.path),
    newlyRecognized: true,
  }
}
