import { app } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type ModelId = 'segformer-b0-ade20k' | 'segformer-b2-ade20k'

interface ModelDefinition {
  fileName: string
  url: string
  sha256: string
  license: string
  source: string
  licenseUrl: string
}

export interface LoadedModel {
  id: ModelId
  path: string
  sha256: string
  license: string
  source: string
}

export const MODEL_REGISTRY: Record<ModelId, ModelDefinition> = {
  'segformer-b0-ade20k': {
    fileName: 'model.onnx',
    url: 'https://modelscope.cn/models/Xenova/segformer-b0-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b0-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
  'segformer-b2-ade20k': {
    fileName: 'model.onnx',
    url: 'https://modelscope.cn/models/Xenova/segformer-b2-finetuned-ade-512-512/resolve/master/onnx/model.onnx',
    sha256: '819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0',
    license: 'NVIDIA SegFormer License (open-source non-commercial use only)',
    source: 'https://modelscope.cn/models/Xenova/segformer-b2-finetuned-ade-512-512',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
  },
}

const pendingLoads = new Map<ModelId, Promise<LoadedModel>>()

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function loadModelOnce(id: ModelId): Promise<LoadedModel> {
  const definition = MODEL_REGISTRY[id]
  if (!definition) throw new Error(`未知模型: ${id}`)
  const modelDir = path.join(app.getPath('userData'), 'models', id)
  const modelPath = path.join(modelDir, definition.fileName)
  const metadataPath = path.join(modelDir, 'model.json')
  await mkdir(modelDir, { recursive: true })

  const cached = await readFile(modelPath).catch(() => null)
  if (cached && sha256(cached) === definition.sha256) {
    await writeFile(metadataPath, JSON.stringify({ id, ...definition }, null, 2), 'utf8')
    return { id, path: modelPath, sha256: definition.sha256, license: definition.license, source: definition.source }
  }
  if (cached) await rm(modelPath, { force: true })

  const response = await fetch(definition.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`模型下载失败 (${response.status})`)
  const declaredSize = Number(response.headers.get('content-length') ?? 0)
  if (declaredSize > 1024 * 1024 * 1024) throw new Error('模型文件大小异常')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== definition.sha256) throw new Error('模型文件校验失败，请重试')

  const temporaryPath = `${modelPath}.${process.pid}.${Date.now()}.download`
  try {
    await writeFile(temporaryPath, bytes)
    await rename(temporaryPath, modelPath)
    await writeFile(metadataPath, JSON.stringify({ id, ...definition }, null, 2), 'utf8')
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
  return { id, path: modelPath, sha256: definition.sha256, license: definition.license, source: definition.source }
}

/** 下载并校验模型；缓存命中时不会访问网络。 */
export function loadModel(id: ModelId): Promise<LoadedModel> {
  const pending = pendingLoads.get(id)
  if (pending) return pending
  const request = loadModelOnce(id).finally(() => pendingLoads.delete(id))
  pendingLoads.set(id, request)
  return request
}
