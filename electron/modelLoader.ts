import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { SAM_MODEL, SEGMENTATION_MODELS, type SemanticSegmentationModelId } from '../src/shared/segmentationModels'

export type ModelId = SemanticSegmentationModelId

interface ModelDefinition {
  fileName: string
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
  id: typeof SAM_MODEL.id
  visionEncoderPath: string
  promptDecoderPath: string
  sha256: Record<'visionEncoder' | 'promptDecoder', string>
  license: string
  source: string
}

export const MODEL_REGISTRY: Record<ModelId, ModelDefinition> = Object.fromEntries(SEGMENTATION_MODELS.map((model) => [model.id, {
    fileName: 'model.onnx',
    url: model.url,
    sha256: model.sha256,
    sizeBytes: model.sizeBytes,
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: `https://modelscope.cn/models/Xenova/${model.id.replace('-ade20k', '')}-finetuned-ade-512-512`,
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
}])) as Record<ModelId, ModelDefinition>

const pendingLoads = new Map<ModelId, Promise<LoadedModel>>()
let pendingSamLoad: Promise<LoadedSamModel> | null = null

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

async function loadSamModelOnce(onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedSamModel> {
  const modelDir = path.join(app.getPath('userData'), 'models', SAM_MODEL.id)
  await mkdir(modelDir, { recursive: true })
  const totalBytes = SAM_MODEL.sizeBytes
  const visionEncoderPath = await loadModelFile(modelDir, SAM_MODEL.files.visionEncoder, (progress) => {
    onProgress?.({ completedBytes: progress.completedBytes, totalBytes })
  })
  const promptDecoderPath = await loadModelFile(modelDir, SAM_MODEL.files.promptDecoder, (progress) => {
    onProgress?.({
      completedBytes: SAM_MODEL.files.visionEncoder.sizeBytes + progress.completedBytes,
      totalBytes,
    })
  })
  await writeFile(path.join(modelDir, 'model.json'), JSON.stringify(SAM_MODEL, null, 2), 'utf8')
  return {
    id: SAM_MODEL.id,
    visionEncoderPath,
    promptDecoderPath,
    sha256: {
      visionEncoder: SAM_MODEL.files.visionEncoder.sha256,
      promptDecoder: SAM_MODEL.files.promptDecoder.sha256,
    },
    license: SAM_MODEL.license,
    source: SAM_MODEL.source,
  }
}

/** 下载并校验 SAM 点选蒙版模型；缓存命中时不会访问网络。 */
export function loadSamModel(onProgress?: (progress: ModelLoadProgress) => void): Promise<LoadedSamModel> {
  if (!pendingSamLoad) pendingSamLoad = loadSamModelOnce(onProgress).finally(() => { pendingSamLoad = null })
  return pendingSamLoad
}
