import type { WorkspaceMediaAsset, WorkspacePixelFlowState } from '../../../shared/types'
import { combinePixelFlowDepthMask, type PixelFlowMask } from './pixelFlowRender'

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

export interface PixelFlowBatchMaskApi {
  loadMask: (projectId: string, path: string) => Promise<StoredMask>
  segment: (request: {
    requestId: string
    filePath: string
    frameTime?: number
    targetId: 'subject' | 'sky'
  }) => Promise<SegmentationResult>
  saveMask: (
    projectId: string,
    assetId: string,
    width: number,
    height: number,
    bytes: Uint8Array,
  ) => Promise<SavedMask>
}

export interface ResolvedPixelFlowBatchMask {
  maskPath?: string
  skyMaskPath?: string
  depthMaskPath: string
  newlyPrepared: boolean
}

function toMask(stored: StoredMask): PixelFlowMask {
  return { data: new Uint8Array(stored.bytes), width: stored.width, height: stored.height }
}

async function saveDepthMask(
  projectId: string,
  assetId: string,
  subject: PixelFlowMask,
  sky: PixelFlowMask,
  api: PixelFlowBatchMaskApi,
): Promise<string> {
  const combined = combinePixelFlowDepthMask(subject, sky)
  const saved = await api.saveMask(
    projectId,
    `${assetId}-pixel-flow-depth`,
    combined.width,
    combined.height,
    combined.data,
  )
  return saved.path
}

export async function resolvePixelFlowBatchMask(options: {
  projectId: string
  asset: WorkspaceMediaAsset
  savedState?: WorkspacePixelFlowState
  api: PixelFlowBatchMaskApi
}): Promise<ResolvedPixelFlowBatchMask> {
  const { projectId, asset, savedState, api } = options
  const ownsSavedMask = !savedState?.maskAssetId || savedState.maskAssetId === asset.id

  if (ownsSavedMask && savedState?.depthMaskPath) {
    try {
      await api.loadMask(projectId, savedState.depthMaskPath)
      return {
        maskPath: savedState.maskPath,
        skyMaskPath: savedState.skyMaskPath,
        depthMaskPath: savedState.depthMaskPath,
        newlyPrepared: false,
      }
    } catch {
      // Missing or damaged combined masks are rebuilt below.
    }
  }

  if (ownsSavedMask && savedState?.maskPath && savedState.skyMaskPath) {
    try {
      const [storedSubject, storedSky] = await Promise.all([
        api.loadMask(projectId, savedState.maskPath),
        api.loadMask(projectId, savedState.skyMaskPath),
      ])
      return {
        maskPath: savedState.maskPath,
        skyMaskPath: savedState.skyMaskPath,
        depthMaskPath: await saveDepthMask(projectId, asset.id, toMask(storedSubject), toMask(storedSky), api),
        newlyPrepared: true,
      }
    } catch {
      // Incomplete saved masks fall through to automatic recognition.
    }
  }

  const requestPrefix = crypto.randomUUID()
  const frameTime = asset.kind === 'video' ? 0 : undefined
  const subjectResult = await api.segment({
    requestId: `${requestPrefix}-subject`,
    filePath: asset.path,
    frameTime,
    targetId: 'subject',
  })
  const subject = toMask(subjectResult)
  const savedSubject = await api.saveMask(
    projectId,
    `${asset.id}-pixel-flow-subject`,
    subject.width,
    subject.height,
    subject.data,
  )

  let sky = { data: new Uint8Array(subject.width * subject.height), width: subject.width, height: subject.height }
  try {
    sky = toMask(await api.segment({
      requestId: `${requestPrefix}-sky`,
      filePath: asset.path,
      frameTime,
      targetId: 'sky',
    }))
  } catch {
    // A scene without sky still uses subject and background regions.
  }
  const savedSky = await api.saveMask(
    projectId,
    `${asset.id}-pixel-flow-sky`,
    sky.width,
    sky.height,
    sky.data,
  )
  const depthMaskPath = await saveDepthMask(projectId, asset.id, subject, sky, api)
  return {
    maskPath: savedSubject.path,
    skyMaskPath: savedSky.path,
    depthMaskPath,
    newlyPrepared: true,
  }
}
