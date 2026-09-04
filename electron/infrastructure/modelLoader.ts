import { app } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { COMPOSITION_MODELS, type CompositionModelId } from '../../src/shared/compositionModels'
import { REFERENCE_MATCH_MODELS, type ReferenceMatchModelId } from '../../src/shared/referenceMatchModels'
import { AI_SELECTION_MODELS, SAM_MODELS, SEGMENTATION_MODELS, SPECIALIZED_SEGMENTATION_MODELS, type AiSelectionModelId, type SamSegmentationModelId, type SegmentationModelId, type SingleFileSegmentationModelId } from '../../src/shared/segmentationModels'
import { loadVerifiedModelFile } from './modelFileService'
import { SharedLoadRegistry } from './sharedLoadRegistry'
import { hasCachedModelFiles } from './modelCacheStatus'
import { logMainError } from './loggerService'

export type ModelId = SingleFileSegmentationModelId | AiSelectionModelId | CompositionModelId | ReferenceMatchModelId

interface ModelDefinition {
  name: string
  fileName: string
  version: string
  url: string
  mirrors?: readonly string[]
  sha256: string
  sizeBytes: number
  license: string
  source: string
  licenseUrl: string
}

export interface ModelLoadProgress {
  completedBytes: number
  totalBytes: number
}

export interface LoadedModel {
  id: ModelId
  path: string
  sha256: string
  license: string
  source: string
}

export interface LoadedSamModel {
  id: SamSegmentationModelId
  visionEncoderPath: string
  promptDecoderPath: string
  sha256: Record<'visionEncoder' | 'promptDecoder', string>
  license: string
  source: string
}

export interface ModelCacheStatus {
  modelId: SegmentationModelId
  cached: boolean
  sizeBytes: number
}

export const MODEL_REGISTRY: Record<ModelId, ModelDefinition> = Object.fromEntries([...SEGMENTATION_MODELS, ...SPECIALIZED_SEGMENTATION_MODELS, ...AI_SELECTION_MODELS, ...COMPOSITION_MODELS, ...REFERENCE_MATCH_MODELS].map((model) => [model.id, {
    name: model.name,
    fileName: 'model.onnx',
    version: model.version,
    url: model.url,
    mirrors: 'mirrors' in model ? model.mirrors : undefined,
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    license: model.license,
    source: model.source,
    licenseUrl: model.licenseUrl,
}])) as Record<ModelId, ModelDefinition>

const pendingLoads = new SharedLoadRegistry<ModelId, LoadedModel, ModelLoadProgress>()
const pendingSamLoads = new SharedLoadRegistry<SamSegmentationModelId, LoadedSamModel, ModelLoadProgress>()

async function loadModelFile(
  modelDir: string,
  definition: Pick<ModelDefinition, 'fileName' | 'url' | 'mirrors' | 'sha256' | 'sizeBytes'>,
  onProgress?: (progress: ModelLoadProgress) => void,
  signal?: AbortSignal,
  label = '模型',
): Promise<string> {
  return loadVerifiedModelFile(modelDir, definition, { onProgress, signal, label })
}

async function loadModelOnce(id: ModelId, onProgress?: (progress: ModelLoadProgress) => void, signal?: AbortSignal): Promise<LoadedModel> {
  const definition = MODEL_REGISTRY[id]
  if (!definition) throw new Error(`未知模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', id)
  try {
    await mkdir(modelDir, { recursive: true })
    const modelPath = await loadModelFile(modelDir, definition, onProgress, signal, `模型「${definition.name}」(${id})`)
    await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({ id, ...definition }, null, 2), 'utf8')
    return { id, path: modelPath, sha256: definition.sha256, license: definition.license, source: definition.source }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    const message = error instanceof Error ? error.message : String(error)
    logMainError('[模型] 准备失败', {
      modelId: id,
      modelName: definition.name,
      fileName: definition.fileName,
      url: definition.url,
      mirrors: definition.mirrors ?? [],
      error: message,
    })
    throw new Error(`模型「${definition.name}」(${id})准备失败：${message}`)
  }
}

/** 下载并校验模型；缓存命中时不会访问网络。 */
export function loadModel(id: ModelId, onProgress?: (progress: ModelLoadProgress) => void, signal?: AbortSignal): Promise<LoadedModel> {
  return pendingLoads.load(id, (loadSignal, reportProgress) => loadModelOnce(id, reportProgress, loadSignal), {
    signal,
    onProgress,
  })
}

async function loadSamModelOnce(id: SamSegmentationModelId, onProgress?: (progress: ModelLoadProgress) => void, signal?: AbortSignal): Promise<LoadedSamModel> {
  const definition = SAM_MODELS.find((model) => model.id === id)
  if (!definition) throw new Error(`未知点选模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', definition.id)
  await mkdir(modelDir, { recursive: true })
  const totalBytes = definition.sizeBytes
  const modelLabel = `点选模型「${definition.name}」(${id})`
  const visionEncoderPath = await loadModelFile(modelDir, definition.files.visionEncoder, (progress) => {
    onProgress?.({ completedBytes: progress.completedBytes, totalBytes })
  }, signal, modelLabel)
  const promptDecoderPath = await loadModelFile(modelDir, definition.files.promptDecoder, (progress) => {
    onProgress?.({
      completedBytes: definition.files.visionEncoder.sizeBytes + progress.completedBytes,
      totalBytes,
    })
  }, signal, modelLabel)
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify(definition, null, 2), 'utf8')
  return {
    id: definition.id,
    visionEncoderPath,
    promptDecoderPath,
    sha256: {
      visionEncoder: definition.files.visionEncoder.sha256,
      promptDecoder: definition.files.promptDecoder.sha256,
    },
    license: definition.license,
    source: definition.source,
  }
}

/** 下载并校验 SAM 点选蒙版模型；缓存命中时不会访问网络。 */
export function loadSamModel(id: SamSegmentationModelId, onProgress?: (progress: ModelLoadProgress) => void, signal?: AbortSignal): Promise<LoadedSamModel> {
  return pendingSamLoads.load(id, (loadSignal, reportProgress) => loadSamModelOnce(id, reportProgress, loadSignal), {
    signal,
    onProgress,
  })
}

export async function getModelCacheStatus(id: SegmentationModelId): Promise<ModelCacheStatus> {
  const semanticDefinition = MODEL_REGISTRY[id as ModelId]
  if (semanticDefinition) {
    const modelDir = path.join(app.getPath('userData'), 'models', id)
    return {
      modelId: id,
      cached: await hasCachedModelFiles(modelDir, [semanticDefinition]),
      sizeBytes: semanticDefinition.sizeBytes,
    }
  }
  const samDefinition = SAM_MODELS.find((model) => model.id === id)
  if (!samDefinition) throw new Error(`未知模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', id)
  return {
    modelId: id,
    cached: await hasCachedModelFiles(modelDir, Object.values(samDefinition.files)),
    sizeBytes: samDefinition.sizeBytes,
  }
}
