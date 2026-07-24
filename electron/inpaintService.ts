import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WorkspaceObjectRemovalRequest, WorkspaceObjectRemovalResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { INPAINT_MODEL, loadInpaintModel } from './inpaintModelService'
import { dilateInpaintMask, featherInpaintMask, INPAINT_MODEL_SIZE, resampleInpaintMask } from './inpaintMask'

const MODEL_SIZE = INPAINT_MODEL_SIZE
const MAX_PIXELS = 100_000_000

function appRoot(): string { return process.env.APP_ROOT ?? path.join(import.meta.dirname, '..') }
function workerPath(): string {
  const name = process.platform === 'win32' ? 'luna-inpaint-worker.exe' : 'luna-inpaint-worker'
  return app.isPackaged ? path.join(process.resourcesPath, 'luna-render-core', name) : path.join(appRoot(), 'luna-render-core', name)
}

async function runProcess(executable: string, args: string[], options: { input?: Buffer; signal?: AbortSignal; maxOutput?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > (options.maxOutput ?? 512 * 1024 * 1024)) child.kill()
      else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve(Buffer.concat(stdout)) : reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || '图片处理失败')))
    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

async function scaleRaw(input: Buffer, pixelFormat: 'rgb24' | 'gray', from: number, width: number, height: number, signal?: AbortSignal): Promise<Buffer> {
  return runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', pixelFormat, '-video_size', `${from}x${from}`, '-i', 'pipe:0', '-vf', `scale=${width}:${height}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', pixelFormat, 'pipe:1'], { input, signal })
}

export async function removeObject(request: WorkspaceObjectRemovalRequest, downloadDir: string, width: number, height: number, signal?: AbortSignal): Promise<WorkspaceObjectRemovalResult> {
  if (width * height > MAX_PIXELS) throw new Error('图片尺寸过大，暂不支持消除')
  const maskBytes = request.maskBytes instanceof Uint8Array ? request.maskBytes : new Uint8Array(request.maskBytes)
  if (maskBytes.byteLength !== request.maskWidth * request.maskHeight || !maskBytes.some((value) => value >= 16)) throw new Error('请先选择要消除的区域')
  const directory = await mkdtemp(path.join(tmpdir(), 'luna-inpaint-'))
  try {
    signal?.throwIfAborted()
    const [modelPath, original, modelInput] = await Promise.all([
      loadInpaintModel(signal),
      runProcess(getFfmpegPath(), ['-v', 'error', '-i', request.filePath, '-vf', `scale=${width}:${height}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { signal }),
      runProcess(getFfmpegPath(), ['-v', 'error', '-i', request.filePath, '-vf', `scale=${MODEL_SIZE}:${MODEL_SIZE}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { signal }),
    ])
    const binary = resampleInpaintMask(maskBytes, request.maskWidth, request.maskHeight)
    const expanded = dilateInpaintMask(binary, Math.round(request.edgeExpansion))
    const alpha = featherInpaintMask(expanded, Math.round(request.feather))
    const inputPath = path.join(directory, 'input.rgb')
    const maskPath = path.join(directory, 'input.mask')
    const generatedPath = path.join(directory, 'generated.rgb')
    const metricsPath = path.join(directory, 'metrics.json')
    await Promise.all([writeFile(inputPath, modelInput), writeFile(maskPath, expanded)])
    await runProcess(workerPath(), [modelPath, inputPath, maskPath, generatedPath, metricsPath], { signal, maxOutput: 64 * 1024 })
    const [generated, metricsRaw] = await Promise.all([readFile(generatedPath), readFile(metricsPath, 'utf8')])
    const [generatedFull, alphaFull] = await Promise.all([
      scaleRaw(generated, 'rgb24', MODEL_SIZE, width, height, signal),
      scaleRaw(Buffer.from(alpha), 'gray', MODEL_SIZE, width, height, signal),
    ])
    if (original.length !== width * height * 3 || generatedFull.length !== original.length || alphaFull.length !== width * height) throw new Error('消除结果尺寸异常')
    const composite = Buffer.allocUnsafe(original.length)
    for (let pixel = 0; pixel < width * height; pixel++) {
      const mix = alphaFull[pixel] / 255
      for (let channel = 0; channel < 3; channel++) {
        const index = pixel * 3 + channel
        composite[index] = Math.round(original[index] * (1 - mix) + generatedFull[index] * mix)
      }
    }
    const projectId = request.projectId
    if (!/^[\w.-]{1,100}$/.test(projectId)) throw new Error('项目标识无效')
    const outputDir = path.join(downloadDir, 'workspace-projects', projectId, 'removal')
    await mkdir(outputDir, { recursive: true })
    const id = `${Date.now()}-${randomUUID()}`
    const staging = path.join(outputDir, `.${id}.png.tmp`)
    const resultPath = path.join(outputDir, `${id}.png`)
    const savedMaskPath = path.join(outputDir, `${id}.mask`)
    await runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', staging], { input: composite, signal, maxOutput: 64 * 1024 })
    await Promise.all([rename(staging, resultPath), writeFile(savedMaskPath, maskBytes)])
    const metrics = JSON.parse(metricsRaw) as { modelLoadMs: number; inferenceMs: number }
    return { requestId: request.requestId, resultPath, maskPath: savedMaskPath, width, height, modelLoadMs: metrics.modelLoadMs, inferenceMs: metrics.inferenceMs, modelSha256: INPAINT_MODEL.sha256 }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
