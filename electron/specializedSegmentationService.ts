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
  runSpecializedWorkerWithFallback,
} from './specializedSegmentationAttempt.js'

export type SpecializedSegmentationBackend = 'yolo26-seg' | 'birefnet-general-lite'

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

function mpsWorkerLaunch(): SpecializedWorkerLaunch | null {
  const python = process.env.LUNA_BIREFNET_MPS_PYTHON
  if (app.isPackaged || process.platform !== 'darwin' || process.arch !== 'arm64' || !python) return null
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  return {
    executable: python,
    args: [join(appRoot, 'scripts', 'birefnet-mps-worker.py'), '--server'],
  }
}

const onnxWorker = new SpecializedWorkerClient(onnxWorkerLaunch)
const mpsWorker = new SpecializedWorkerClient(() => {
  const launch = mpsWorkerLaunch()
  if (!launch) throw new Error('MPS 工作进程未配置')
  return launch
})

export function shutdownSpecializedSegmentationWorker(): void {
  onnxWorker.shutdown()
  mpsWorker.shutdown()
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
  executionBackend: 'onnx-cpu' | 'pytorch-mps'
  fallbackReason?: string
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
    let executionBackend: 'onnx-cpu' | 'pytorch-mps' = 'onnx-cpu'
    let fallbackReason: string | undefined
    const runAttempt = (worker: SpecializedWorkerClient) => runSpecializedWorkerAttempt(
      worker,
      command,
      outputPath,
      input.outputSize * input.outputSize,
      signal,
    )
    let attempt: Awaited<ReturnType<typeof runAttempt>>
    if (input.backend === 'birefnet-general-lite' && mpsWorkerLaunch()) {
      const outcome = await runSpecializedWorkerWithFallback(
        async () => {
          const result = await runAttempt(mpsWorker)
          executionBackend = 'pytorch-mps'
          return result
        },
        async () => {
          mpsWorker.shutdown()
          return await runAttempt(onnxWorker)
        },
        signal,
      )
      attempt = outcome.attempt
      fallbackReason = outcome.fallbackReason
      if (fallbackReason) {
        executionBackend = 'onnx-cpu'
      } else {
        executionBackend = 'pytorch-mps'
      }
    } else {
      attempt = await runAttempt(onnxWorker)
    }
    return {
      width: input.outputSize,
      height: input.outputSize,
      bytes: attempt.bytes,
      sessionLoadMs: attempt.result.sessionLoadMs,
      workerInferenceMs: attempt.result.inferenceMs,
      sessionReused: attempt.result.sessionReused,
      executionBackend,
      fallbackReason,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
