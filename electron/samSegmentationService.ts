import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

interface SamSegmentationInput {
  visionEncoderPath: string
  promptDecoderPath: string
  rgb: Buffer
  sourceWidth: number
  sourceHeight: number
  pointX: number
  pointY: number
}

interface SamSegmentationResult {
  width: number
  height: number
  bytes: Buffer
}

const execFileAsync = promisify(execFile)

function appRoot(): string {
  return process.env.APP_ROOT ?? join(import.meta.dirname, '..')
}

function workerPath(): string {
  const executable = process.platform === 'win32' ? 'sam-segmentation-worker.exe' : 'sam-segmentation-worker'
  return app.isPackaged
    ? join(process.resourcesPath, 'luna-render-core', executable)
    : join(appRoot(), 'luna-render-core', executable)
}

/** 在独立 Rust 进程中运行 SAM，避免底层运行时异常终止 Electron 主进程。 */
export function segmentSamInWorker(input: SamSegmentationInput, signal?: AbortSignal): Promise<SamSegmentationResult> {
  return runSamWorker(input, signal)
}

async function runSamWorker(input: SamSegmentationInput, signal?: AbortSignal): Promise<SamSegmentationResult> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-sam-'))
  const inputPath = join(directory, 'input.rgb')
  const outputPath = join(directory, 'output.mask')
  try {
    signal?.throwIfAborted()
    await writeFile(inputPath, input.rgb, { signal })
    await execFileAsync(workerPath(), [
      input.visionEncoderPath,
      input.promptDecoderPath,
      inputPath,
      outputPath,
      String(input.sourceWidth),
      String(input.sourceHeight),
      String(input.pointX),
      String(input.pointY),
    ], { timeout: 90_000, maxBuffer: 64 * 1024, signal })
    const bytes = await readFile(outputPath, { signal })
    const expectedSize = input.sourceWidth * input.sourceHeight
    if (bytes.byteLength !== expectedSize) throw new Error('SAM 返回的蒙版尺寸无效')
    return { width: input.sourceWidth, height: input.sourceHeight, bytes }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
