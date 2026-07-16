import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

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

const execFileAsync = promisify(execFile)

function workerPath(): string {
  const executable = process.platform === 'win32' ? 'specialized-segmentation-worker.exe' : 'specialized-segmentation-worker'
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  return app.isPackaged
    ? join(process.resourcesPath, 'luna-render-core', executable)
    : join(appRoot, 'luna-render-core', executable)
}

export async function segmentSpecializedInWorker(
  input: SpecializedSegmentationInput,
  signal?: AbortSignal,
): Promise<{ width: number; height: number; bytes: Buffer }> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-specialized-'))
  const inputPath = join(directory, 'input.rgb')
  const outputPath = join(directory, 'output.mask')
  try {
    signal?.throwIfAborted()
    await writeFile(inputPath, input.rgb, { signal })
    await execFileAsync(workerPath(), [
      input.backend,
      input.modelPath,
      inputPath,
      outputPath,
      String(input.scaledWidth),
      String(input.scaledHeight),
      String(input.padX),
      String(input.padY),
      String(input.outputSize),
    ], { timeout: 90_000, maxBuffer: 64 * 1024, signal })
    const bytes = await readFile(outputPath, { signal })
    if (bytes.byteLength !== input.outputSize * input.outputSize) throw new Error('专用分割返回尺寸无效')
    return { width: input.outputSize, height: input.outputSize, bytes }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
