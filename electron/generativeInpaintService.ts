import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { WorkspaceGenerativeRemovalCapability, WorkspaceObjectRemovalRequest, WorkspaceObjectRemovalResult } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { GENERATIVE_INPAINT_MODEL, getCachedGenerativeInpaintModel, loadGenerativeInpaintModel, resolveGenerativeRuntime } from './generativeInpaintModelService'
import { selectGenerativeGpuDevice, verifyGpuOnlyGenerativeLog } from './generativeInpaintRuntime'
import { compositeInpaintRegion, createInpaintMaskJobs, dilateInpaintMask, featherInpaintMask, INPAINT_MODEL_SIZE, modelRadiusForSourcePixels, prepareInpaintInputs } from './inpaintMask'

const PROMPT = 'empty background matching the surrounding scene, seamless continuation, realistic photograph, natural lighting, high quality'
const NEGATIVE_PROMPT = 'foreground object, person, text, artifact, distortion, blur, duplicate'
const SEED = 42
const STEPS = 20
const STRENGTH = 0.75
const CFG_SCALE = 7
const SAMPLER = 'euler_a'
const RUNTIME_VERSION = 'stable-diffusion.cpp-2251699'

interface ProcessResult { stdout: Buffer; stderr: Buffer }

function runProcess(executable: string, args: string[], options: { input?: Buffer; signal?: AbortSignal; maxOutput?: number } = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], signal: options.signal })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > (options.maxOutput ?? 16 * 1024 * 1024)) child.kill()
      else target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', reject)
    child.once('close', (code) => code === 0
      ? resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) })
      : reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || '生成式重建失败')))
    child.stdin.end(options.input)
  })
}

export async function getGenerativeRemovalCapability(): Promise<WorkspaceGenerativeRemovalCapability> {
  const base = {
    modelCached: Boolean(await getCachedGenerativeInpaintModel()),
    modelSizeBytes: GENERATIVE_INPAINT_MODEL.sizeBytes,
  }
  if (!((process.platform === 'darwin' && process.arch === 'arm64') || process.platform === 'win32')) {
    return { ...base, supported: false, backend: null, deviceName: null, reason: '当前设备不支持生成式重建，只能使用普通消除' }
  }
  const runtime = await resolveGenerativeRuntime()
  if (!runtime) return { ...base, supported: false, backend: null, deviceName: null, reason: '当前安装未包含生成式重建组件' }
  try {
    const result = await runProcess(runtime, ['--list-devices'], { maxOutput: 2 * 1024 * 1024 })
    const device = selectGenerativeGpuDevice(`${result.stdout}\n${result.stderr}`)
    return device
      ? { ...base, supported: true, ...device }
      : { ...base, supported: false, backend: null, deviceName: null, reason: '未检测到支持的显卡，只能使用普通消除' }
  } catch {
    return { ...base, supported: false, backend: null, deviceName: null, reason: '显卡检测失败，只能使用普通消除' }
  }
}

function runtimeBackend(capability: WorkspaceGenerativeRemovalCapability): string {
  if (capability.backend === 'metal') return 'MTL0'
  if (capability.backend === 'cuda') return 'CUDA0'
  throw new Error('当前设备不支持生成式重建')
}

export async function removeObjectGeneratively(request: WorkspaceObjectRemovalRequest, downloadDir: string, width: number, height: number, signal?: AbortSignal): Promise<WorkspaceObjectRemovalResult> {
  const capability = await getGenerativeRemovalCapability()
  if (!capability.supported || !capability.backend || !capability.deviceName) throw new Error(capability.reason ?? '当前设备不支持生成式重建')
  const runtime = await resolveGenerativeRuntime()
  if (!runtime) throw new Error('当前安装未包含生成式重建组件')
  const directory = await mkdtemp(path.join(tmpdir(), 'luna-generative-inpaint-'))
  const startedAt = performance.now()
  try {
    const [modelPath, decoded] = await Promise.all([
      loadGenerativeInpaintModel(signal),
      runProcess(getFfmpegPath(), ['-v', 'error', '-i', request.filePath, '-vf', `scale=${width}:${height}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { signal, maxOutput: width * height * 3 + 1024 }),
    ])
    const original = decoded.stdout
    if (original.length !== width * height * 3) throw new Error('图片读取结果尺寸异常')
    const maskBytes = request.maskBytes instanceof Uint8Array ? request.maskBytes : new Uint8Array(request.maskBytes)
    const jobs = createInpaintMaskJobs(maskBytes, request.maskWidth, request.maskHeight, width, height)
    let composite = Buffer.from(original)
    const backend = runtimeBackend(capability)
    for (let index = 0; index < jobs.length; index++) {
      signal?.throwIfAborted()
      const job = jobs[index]
      const prepared = prepareInpaintInputs(composite, width, height, job.mask, request.maskWidth, request.maskHeight, job.region)
      const expanded = dilateInpaintMask(prepared.mask, modelRadiusForSourcePixels(request.edgeExpansion, job.region))
      const alpha = featherInpaintMask(expanded, modelRadiusForSourcePixels(request.feather, job.region))
      const inputPath = path.join(directory, `input-${index}.png`)
      const maskPath = path.join(directory, `mask-${index}.png`)
      const outputPath = path.join(directory, `output-${index}.png`)
      await Promise.all([
        runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '512x512', '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', inputPath], { input: prepared.rgb, signal }),
        runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'gray', '-video_size', '512x512', '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', maskPath], { input: Buffer.from(expanded), signal }),
      ])
      const generated = await runProcess(runtime, [
        '--model', modelPath, '--init-img', inputPath, '--mask', maskPath, '--output', outputPath,
        '--prompt', PROMPT, '--negative-prompt', NEGATIVE_PROMPT, '--width', '512', '--height', '512',
        '--steps', String(STEPS), '--strength', String(STRENGTH), '--seed', String(SEED), '--cfg-scale', String(CFG_SCALE),
        '--sampling-method', SAMPLER, '--backend', backend, '--params-backend', backend, '--fa', '--verbose',
      ], { signal, maxOutput: 16 * 1024 * 1024 })
      verifyGpuOnlyGenerativeLog(`${generated.stdout}\n${generated.stderr}`, backend)
      const decodedOutput = await runProcess(getFfmpegPath(), ['-v', 'error', '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { signal, maxOutput: INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3 + 1024 })
      if (decodedOutput.stdout.length !== INPAINT_MODEL_SIZE * INPAINT_MODEL_SIZE * 3) throw new Error('生成式重建结果尺寸异常')
      composite = compositeInpaintRegion(composite, width, height, decodedOutput.stdout, alpha, job.region)
    }
    if (!/^[\w.-]{1,100}$/.test(request.projectId)) throw new Error('项目标识无效')
    const outputDir = path.join(downloadDir, 'workspace-projects', request.projectId, 'removal')
    await mkdir(outputDir, { recursive: true })
    const id = `${Date.now()}-${randomUUID()}`
    const staging = path.join(outputDir, `.${id}.png.tmp`)
    const maskStaging = path.join(outputDir, `.${id}.mask.tmp`)
    const resultPath = path.join(outputDir, `${id}.png`)
    const savedMaskPath = path.join(outputDir, `${id}.mask`)
    await runProcess(getFfmpegPath(), ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-i', 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', staging], { input: composite, signal })
    await writeFile(maskStaging, maskBytes)
    try {
      await Promise.all([rename(staging, resultPath), rename(maskStaging, savedMaskPath)])
    } catch (error) {
      await Promise.all([resultPath, savedMaskPath, staging, maskStaging].map((filePath) => rm(filePath, { force: true })))
      throw error
    }
    return {
      requestId: request.requestId, resultPath, maskPath: savedMaskPath, width, height,
      modelLoadMs: 0, inferenceMs: performance.now() - startedAt, modelSha256: GENERATIVE_INPAINT_MODEL.sha256, mode: 'generative',
      generation: { backend: capability.backend, deviceName: capability.deviceName, prompt: PROMPT, negativePrompt: NEGATIVE_PROMPT, seed: SEED, steps: STEPS, strength: STRENGTH, cfgScale: CFG_SCALE, sampler: SAMPLER, runtimeVersion: RUNTIME_VERSION },
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
