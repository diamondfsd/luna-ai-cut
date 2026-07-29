import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WorkspaceObjectRemovalRequest, WorkspaceObjectRemovalResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { INPAINT_MODEL, loadInpaintModel } from './inpaintModelService'
import { compositeInpaintRegion, createInpaintMaskJobs, dilateInpaintMask, featherInpaintMask, INPAINT_MODEL_SIZE, modelRadiusForSourcePixels, prepareInpaintInputs } from './inpaintMask'
import { fileSha256 } from './resumableDownloadService'

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

export async function removeObject(request: WorkspaceObjectRemovalRequest, downloadDir: string, width: number, height: number, signal?: AbortSignal): Promise<WorkspaceObjectRemovalResult> {
  if (width * height > MAX_PIXELS) throw new Error('图片尺寸过大，暂不支持消除')
  const maskBytes = request.maskBytes instanceof Uint8Array ? request.maskBytes : new Uint8Array(request.maskBytes)
  if (maskBytes.byteLength !== request.maskWidth * request.maskHeight || !maskBytes.some((value) => value >= 16)) throw new Error('请先选择要消除的区域')
  const directory = await mkdtemp(path.join(tmpdir(), 'luna-inpaint-'))
  try {
    signal?.throwIfAborted()
    const [modelPath, original] = await Promise.all([
      loadInpaintModel(signal),
      runProcess(getFfmpegPath(), ['-v', 'error', '-i', request.filePath, '-vf', `scale=${width}:${height}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { signal }),
    ])
    if (original.length !== width * height * 3) throw new Error('图片读取结果尺寸异常')
    const jobs = createInpaintMaskJobs(maskBytes, request.maskWidth, request.maskHeight, width, height)
    const preparedJobs = jobs.map((job, index) => {
      const prepared = prepareInpaintInputs(original, width, height, job.mask, request.maskWidth, request.maskHeight, job.region)
      const expanded = dilateInpaintMask(prepared.mask, modelRadiusForSourcePixels(request.edgeExpansion, job.region))
      return {
        region: job.region,
        rgb: prepared.rgb,
        mask: expanded,
        alpha: featherInpaintMask(expanded, modelRadiusForSourcePixels(request.feather, job.region)),
        inputPath: path.join(directory, `input-${index}.rgb`),
        maskPath: path.join(directory, `input-${index}.mask`),
        outputPath: path.join(directory, `generated-${index}.rgb`),
      }
    })
    const manifestPath = path.join(directory, 'jobs.json')
    const metricsPath = path.join(directory, 'metrics.json')
    await Promise.all([
      ...preparedJobs.flatMap((job) => [writeFile(job.inputPath, job.rgb), writeFile(job.maskPath, job.mask)]),
      writeFile(manifestPath, JSON.stringify({ jobs: preparedJobs.map(({ inputPath, maskPath, outputPath }) => ({ inputPath, maskPath, outputPath })) })),
    ])
    await runProcess(workerPath(), [modelPath, manifestPath, metricsPath], { signal, maxOutput: 64 * 1024 })
    const [generatedRegions, metricsRaw] = await Promise.all([
      Promise.all(preparedJobs.map((job) => readFile(job.outputPath))),
      readFile(metricsPath, 'utf8'),
    ])
    let composite = Buffer.from(original)
    for (let index = 0; index < preparedJobs.length; index++) {
      const generated = generatedRegions[index]
      if (generated.length !== INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3) throw new Error('消除结果尺寸异常')
      const job = preparedJobs[index]
      composite = compositeInpaintRegion(composite, width, height, generated, job.alpha, job.region)
    }
    const projectId = request.projectId
    if (!/^[\w.-]{1,100}$/.test(projectId)) throw new Error('项目标识无效')
    const outputDir = path.join(downloadDir, 'workspace-projects', projectId, 'removal')
    await mkdir(outputDir, { recursive: true })
    const id = `${Date.now()}-${randomUUID()}`
    const staging = path.join(outputDir, `.${id}.png.tmp`)
    const maskStaging = path.join(outputDir, `.${id}.mask.tmp`)
    const resultPath = path.join(outputDir, `${id}.png`)
    const savedMaskPath = path.join(outputDir, `${id}.mask`)
    await runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', staging], { input: composite, signal, maxOutput: 64 * 1024 })
    await writeFile(maskStaging, maskBytes)
    const [resultInfo, resultSha256] = await Promise.all([stat(staging), fileSha256(staging, signal)])
    if (!resultSha256) throw new Error('消除结果校验失败')
    const maskSha256 = createHash('sha256').update(maskBytes).digest('hex')
    try {
      await Promise.all([rename(staging, resultPath), rename(maskStaging, savedMaskPath)])
    } catch (error) {
      await Promise.all([resultPath, savedMaskPath, staging, maskStaging].map((filePath) => rm(filePath, { force: true })))
      throw error
    }
    const metrics = JSON.parse(metricsRaw) as { modelLoadMs: number; inferenceMs: number; regionCount: number }
    return {
      requestId: request.requestId,
      resultPath,
      maskPath: savedMaskPath,
      resultBytes: resultInfo.size,
      resultSha256,
      maskBytes: maskBytes.byteLength,
      maskSha256,
      width,
      height,
      modelLoadMs: metrics.modelLoadMs,
      inferenceMs: metrics.inferenceMs,
      modelSha256: INPAINT_MODEL.sha256,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
