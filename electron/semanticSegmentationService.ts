import { execFile } from 'node:child_process'
import { app } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { parseSemanticWorkerOutput, type SemanticSegmentationResult } from './semanticWorkerProtocol'

const GUIDE_MAX_EDGE = 2048

interface SemanticRefinementGuide {
  rgb: Buffer
  width: number
  height: number
}

interface SemanticSegmentationInput {
  modelPath: string
  rgb: Buffer
  pointX: number
  pointY: number
  targetClassId?: number
  inputSize: number
  guide?: SemanticRefinementGuide
}

const execFileAsync = promisify(execFile)

function workerPath(): string {
  const executable = process.platform === 'win32' ? 'semantic-segmentation-worker.exe' : 'semantic-segmentation-worker'
  const appRoot = process.env.APP_ROOT ?? join(import.meta.dirname, '..')
  return app.isPackaged
    ? join(process.resourcesPath, 'luna-render-core', executable)
    : join(appRoot, 'luna-render-core', executable)
}

export async function prepareSemanticRefinementGuide(
  filePath: string,
  sourceSize: { width: number; height: number },
  signal?: AbortSignal,
): Promise<SemanticRefinementGuide> {
  const scale = Math.min(1, GUIDE_MAX_EDGE / Math.max(sourceSize.width, sourceSize.height))
  const width = Math.max(1, Math.round(sourceSize.width * scale))
  const height = Math.max(1, Math.round(sourceSize.height * scale))
  const { stdout } = await execFileAsync(getFfmpegPath(), [
    '-v', 'error',
    '-i', filePath,
    '-vf', `scale=${width}:${height}:flags=lanczos`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1',
  ], { encoding: 'buffer', maxBuffer: width * height * 3 + 1024, signal })
  const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (rgb.byteLength !== width * height * 3) throw new Error('无法准备清晰边缘所需的图片')
  return { rgb, width, height }
}

export async function segmentSemanticInWorker(
  input: SemanticSegmentationInput,
  signal?: AbortSignal,
): Promise<SemanticSegmentationResult> {
  const directory = await mkdtemp(join(tmpdir(), 'luna-semantic-'))
  const inputPath = join(directory, 'input.rgb')
  const guidePath = join(directory, 'guide.rgb')
  const outputPath = join(directory, 'output.mask')
  try {
    signal?.throwIfAborted()
    await Promise.all([
      writeFile(inputPath, input.rgb, { signal }),
      input.guide ? writeFile(guidePath, input.guide.rgb, { signal }) : Promise.resolve(),
    ])
    const args = [
      input.modelPath,
      inputPath,
      outputPath,
      String(input.pointX),
      String(input.pointY),
      input.targetClassId === undefined ? '-' : String(input.targetClassId),
      String(input.inputSize),
    ]
    if (input.guide) args.push(guidePath, String(input.guide.width), String(input.guide.height))
    await execFileAsync(workerPath(), args, { timeout: 90_000, maxBuffer: 64 * 1024, signal })
    return parseSemanticWorkerOutput(await readFile(outputPath, { signal }))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
