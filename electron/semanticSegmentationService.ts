import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseSemanticWorkerOutput, type SemanticSegmentationResult } from './semanticWorkerProtocol'

interface SemanticSegmentationInput {
  modelPath: string
  rgb: Buffer
  pointX: number
  pointY: number
  targetClassId?: number
  inputSize: number
}

const execFileAsync = promisify(execFile)

function workerPath(): string {
  const executable = process.platform === 'win32' ? 'semantic-segmentation-worker.exe' : 'semantic-segmentation-worker'
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  return app.isPackaged
    ? join(process.resourcesPath, 'luna-render-core', executable)
    : join(appRoot, 'luna-render-core', executable)
}

export async function segmentSemanticInWorker(
  input: SemanticSegmentationInput,
  signal?: AbortSignal,
): Promise<SemanticSegmentationResult> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-semantic-'))
  const inputPath = join(directory, 'input.rgb')
  const outputPath = join(directory, 'output.mask')
  try {
    signal?.throwIfAborted()
    await writeFile(inputPath, input.rgb, { signal })
    await execFileAsync(workerPath(), [
      input.modelPath,
      inputPath,
      outputPath,
      String(input.pointX),
      String(input.pointY),
      input.targetClassId === undefined ? '-' : String(input.targetClassId),
      String(input.inputSize),
    ], { timeout: 90_000, maxBuffer: 64 * 1024, signal })
    return parseSemanticWorkerOutput(await readFile(outputPath, { signal }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
