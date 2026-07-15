import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SAM_MODELS, SEGMENTATION_MODELS, type SamSegmentationModelId, type SemanticSegmentationModelId } from '../src/shared/segmentationModels'

export type ModelId = SemanticSegmentationModelId

interface ModelDefinition {
  fileName: string
  version: string
  url: string
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

export const MODEL_REGISTRY: Record<ModelId, ModelDefinition> = Object.fromEntries(SEGMENTATION_MODELS.map((model) => [model.id, {
    fileName: 'model.onnx',
    version: model.version,
    url: model.url,
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    license: model.license,
    source: model.source,
    licenseUrl: model.licenseUrl,
}])) as Record<ModelId, ModelDefinition>

const pendingLoads = new Map<ModelId, Promise<LoadedModel>>()
const pendingSamLoads = new Map<SamSegmentationModelId, Promise<LoadedSamModel>>()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function loadModelFile(
  modelDir: string,
  definition: Pick<ModelDefinition, 'fileName' | 'url' | 'sha256' | 'sizeBytes'>,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<string> {
  const modelPath = path.join(modelDir, definition.fileName)
  const cached = await readFile(modelPath).catch(() => null)
  if (cached && sha256(cached) === definition.sha256) {
    onProgress?.({ completedBytes: definition.sizeBytes, totalBytes: definition.sizeBytes })
    return modelPath
  }
  if (cached) await rm(modelPath, { force: true })

  const response = await fetch(definition.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`模型下载失败 (${response.status})`)
  const declaredSize = Number(response.headers.get('content-length') ?? definition.sizeBytes)
  if (declaredSize > 1024 * 1024 * 1024) throw new Error('模型文件大小异常')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('模型下载没有返回文件内容')
  const chunks: Uint8Array[] = []
  let completedBytes = 0
  onProgress?.({ completedBytes, totalBytes: declaredSize })
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    completedBytes += value.byteLength
    onProgress?.({ completedBytes, totalBytes: declaredSize })
  }
  const bytes = new Uint8Array(completedBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (sha256(bytes) !== definition.sha256) throw new Error('模型文件校验失败，请重试')

  const temporaryPath = `${modelPath}.${process.pid}.${Date.now()}.download`
  try {
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, modelPath)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return modelPath
}

async function loadModelOnce(id: ModelId, onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedModel> {
  const definition = MODEL_REGISTRY[id]
  if (!definition) throw new Error(`未知模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', id)
  await mkdir(modelDir, { recursive: true })
  const modelPath = await loadModelFile(modelDir, definition, onProgress)
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify({ id, ...definition }, null, 2), 'utf8')
  return { id, path: modelPath, sha256: definition.sha256, license: definition.license, source: definition.source }
}

/** 下载并校验模型；缓存命中时不会访问网络。 */
export function loadModel(id: ModelId, onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedModel> {
  const pending = pendingLoads.get(id)
  if (pending) return pending
  const request = loadModelOnce(id, onProgress).finally(() => pendingLoads.delete(id))
  pendingLoads.set(id, request)
  return request
}

async function loadSamModelOnce(id: SamSegmentationModelId, onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedSamModel> {
  const definition = SAM_MODELS.find((model) => model.id === id)
  if (!definition) throw new Error(`未知点选模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', definition.id)
  await mkdir(modelDir, { recursive: true })
  const totalBytes = definition.sizeBytes
  const visionEncoderPath = await loadModelFile(modelDir, definition.files.visionEncoder, (progress) => {
    onProgress?.({ completedBytes: progress.completedBytes, totalBytes })
  })
  const promptDecoderPath = await loadModelFile(modelDir, definition.files.promptDecoder, (progress) => {
    onProgress?.({
      completedBytes: definition.files.visionEncoder.sizeBytes + progress.completedBytes,
      totalBytes,
    })
  })
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
export function loadSamModel(id: SamSegmentationModelId, onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedSamModel> {
  const pending = pendingSamLoads.get(id)
  if (pending) return pending
  const request = loadSamModelOnce(id, onProgress).finally(() => pendingSamLoads.delete(id))
  pendingSamLoads.set(id, request)
  return request
}
