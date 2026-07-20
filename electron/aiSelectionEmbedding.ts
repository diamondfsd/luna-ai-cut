import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadVerifiedModelFile } from './modelFileService'
import { extractImageEmbeddingInWorker } from './specializedSegmentationService'

export const IMAGE_EMBEDDING_VERSION = 'dinov2-small-onnx-int8-v1'

const EMBEDDING_MODEL = {
  fileName: 'model.onnx',
  sizeBytes: 24_451_943,
  url: 'https://modelscope.cn/models/Xenova/dinov2-small/resolve/master/onnx/model_quantized.onnx',
  mirrors: ['https://huggingface.co/Xenova/dinov2-small/resolve/main/onnx/model_quantized.onnx'],
  sha256: '3afdc8bc63b50558d6e5770f5b799bb82455c2311183a2de43803f343a29d917',
} as const

let pendingModel: Promise<string> | null = null

function loadImageEmbeddingModel(signal?: AbortSignal): Promise<string> {
  if (!pendingModel) {
    pendingModel = (async () => {
      const directory = join(app.getPath('userData'), 'models', 'dinov2-small')
      await mkdir(directory, { recursive: true })
      return loadVerifiedModelFile(directory, EMBEDDING_MODEL, { signal })
    })().catch((error) => {
      pendingModel = null
      throw error
    })
  }
  return pendingModel
}

export async function prepareImageEmbeddingModel(signal?: AbortSignal): Promise<{ path: string | null; error: string | null }> {
  try {
    return { path: await loadImageEmbeddingModel(signal), error: null }
  } catch (error) {
    signal?.throwIfAborted()
    return { path: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function decodeEmbeddingInput(filePath: string, signal?: AbortSignal): Promise<Buffer> {
  const size = 224
  return new Promise((resolve, reject) => {
    execFile(getFfmpegPath(), [
      '-v', 'error', '-i', filePath, '-frames:v', '1',
      '-vf', 'scale=256:256:force_original_aspect_ratio=increase,crop=224:224',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: size * size * 3 + 1024, signal }, (error, stdout) => {
      if (error) reject(error)
      else {
        const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
        if (rgb.byteLength !== size * size * 3) reject(new Error('无法读取用于视觉分析的画面'))
        else resolve(rgb)
      }
    })
  })
}

export async function analyzeImageEmbedding(filePath: string, modelPath: string, signal?: AbortSignal): Promise<number[]> {
  const rgb = await decodeEmbeddingInput(filePath, signal)
  const embedding = await extractImageEmbeddingInWorker(modelPath, rgb, signal)
  return embedding.map((value) => Math.max(-127, Math.min(127, Math.round(value * 127))))
}
