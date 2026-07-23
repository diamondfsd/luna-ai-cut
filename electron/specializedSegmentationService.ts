import { app } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SpecializedWorkerClient,
  type SpecializedWorkerLaunch,
} from './specializedWorkerClient.js'
import {
  runSpecializedWorkerAttempt,
} from './specializedSegmentationAttempt.js'

export type SpecializedSegmentationBackend =
  | 'yolo26-seg'
  | 'yolo26-labels'
  | 'segformer-labels'
  | 'rmbg-1.4'
  | 'birefnet-general-lite'
  | 'ultraface'
  | 'eye-state'
  | 'dinov2-small'

interface SpecializedSegmentationInput {
  backend: SpecializedSegmentationBackend
  modelPath: string
  rgb: Buffer
  scaledWidth: number
  scaledHeight: number
  padX: number
  padY: number
  outputSize: number
}

function onnxWorkerLaunch(): SpecializedWorkerLaunch {
  const executable = process.platform === 'win32' ? 'specialized-segmentation-worker.exe' : 'specialized-segmentation-worker'
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  return {
    executable: app.isPackaged
    ? join(process.resourcesPath, 'luna-render-core', executable)
      : join(appRoot, 'luna-render-core', executable),
    args: ['--server'],
  }
}

const onnxWorker = new SpecializedWorkerClient(onnxWorkerLaunch)

export function shutdownSpecializedSegmentationWorker(): void {
  onnxWorker.shutdown()
}

export async function segmentSpecializedInWorker(
  input: SpecializedSegmentationInput,
  signal?: AbortSignal,
): Promise<{
  width: number
  height: number
  bytes: Buffer
  sessionLoadMs: number
  workerInferenceMs: number
  sessionReused: boolean
  executionBackend: 'onnx-cpu'
}> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-specialized-'))
  const inputPath = join(directory, 'input.rgb')
  const outputPath = join(directory, 'output.mask')
  try {
    signal?.throwIfAborted()
    await writeFile(inputPath, input.rgb, { signal })
    const command = {
      backend: input.backend,
      modelPath: input.modelPath,
      inputPath,
      outputPath,
      scaledWidth: input.scaledWidth,
      scaledHeight: input.scaledHeight,
      padX: input.padX,
      padY: input.padY,
      outputSize: input.outputSize,
    }
    const attempt = await runSpecializedWorkerAttempt(
      onnxWorker,
      command,
      outputPath,
      input.outputSize * input.outputSize,
      signal,
    )
    return {
      width: input.outputSize,
      height: input.outputSize,
      bytes: attempt.bytes,
      sessionLoadMs: attempt.result.sessionLoadMs,
      workerInferenceMs: attempt.result.inferenceMs,
      sessionReused: attempt.result.sessionReused,
      executionBackend: 'onnx-cpu',
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function extractImageEmbeddingInWorker(
  modelPath: string,
  rgb: Buffer,
  signal?: AbortSignal,
): Promise<number[]> {
  const dimension = 384
  const directory = await mkdtemp(join(tmpdir(), 'luna-embedding-'))
  const inputPath = join(directory, 'input.rgb')
  const outputPath = join(directory, 'output.embedding')
  try {
    signal?.throwIfAborted()
    await writeFile(inputPath, rgb, { signal })
    const attempt = await runSpecializedWorkerAttempt(
      onnxWorker,
      {
        backend: 'dinov2-small',
        modelPath,
        inputPath,
        outputPath,
        scaledWidth: 224,
        scaledHeight: 224,
        padX: 0,
        padY: 0,
        outputSize: dimension,
      },
      outputPath,
      dimension * Float32Array.BYTES_PER_ELEMENT,
      signal,
    )
    const embedding = Array.from({ length: dimension }, (_, index) => attempt.bytes.readFloatLE(index * 4))
    if (embedding.some((value) => !Number.isFinite(value))) throw new Error('视觉模型返回了无效特征')
    return embedding
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
