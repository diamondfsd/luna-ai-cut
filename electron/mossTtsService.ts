import { app } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import type {
  MossTtsGenerationRequest,
  MossTtsGenerationResult,
  MossTtsProgress,
  MossTtsStatus,
} from '../src/shared/types'
import { getSettings } from './settingsService'
import {
  loadVerifiedModelFile,
  type ModelFileDefinition,
  type ModelFileProgress,
} from './modelFileService'
import { logMainInfo, logMainWarn } from './loggerService'
import { hasPythonRuntime, resolvePythonCommand } from './pythonRuntime'

const RUNTIME_FOLDER = 'moss-tts'
const TTS_MODEL_ID = 'openmoss/MOSS-TTS-Nano-100M-ONNX'
const CODEC_MODEL_ID = 'openmoss/MOSS-Audio-Tokenizer-Nano-ONNX'
const TTS_MODEL_REVISION = '0badeaff90722f01b5c727d991d750531cb802e0'
const CODEC_MODEL_REVISION = '82a897035d9ff72803df10a06c1a5aa6691be0f8'
const SOURCE_REVISION = 'cc7bdf19c7639c0870dab22045a33b442760f6be'
const MODELSCOPE_BASE = 'https://modelscope.cn/models'
const THREAD_COUNT = 4

const TTS_MODEL_DIRECTORY = 'MOSS-TTS-Nano-100M-ONNX'
const CODEC_MODEL_DIRECTORY = 'MOSS-Audio-Tokenizer-Nano-ONNX'

interface MossModelFile extends ModelFileDefinition {
  directory: string
  revision: string
}

function modelFile(
  directory: string,
  fileName: string,
  repository: string,
  revision: string,
  sizeBytes: number,
  sha256: string,
): MossModelFile {
  return {
    directory,
    fileName,
    revision,
    sizeBytes,
    sha256,
    url: `${MODELSCOPE_BASE}/${repository}/resolve/${revision}/${fileName}`,
  }
}

const MOSS_MODEL_FILES: readonly MossModelFile[] = [
  modelFile(TTS_MODEL_DIRECTORY, 'browser_poc_manifest.json', TTS_MODEL_ID, TTS_MODEL_REVISION, 470720, '803716e58b71fe2a770af1495ca74797d38c181b41cfeeaf9e524adc15910a20'),
  modelFile(TTS_MODEL_DIRECTORY, 'tts_browser_onnx_meta.json', TTS_MODEL_ID, TTS_MODEL_REVISION, 4302, '1dacbf4d59732ae1fb1253139b70a4ca07415246fb6473919c9947d489a59e04'),
  modelFile(TTS_MODEL_DIRECTORY, 'tokenizer.model', TTS_MODEL_ID, TTS_MODEL_REVISION, 470897, 'c353ee1479b536bf414c1b247f5542b6607fb8ae91320e5af1781fee200fddff'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_prefill.onnx', TTS_MODEL_ID, TTS_MODEL_REVISION, 283305, 'd56126dcd0574c2f15d98fc6b35eda68d0386b5bd9c5e38e28548d6f2ea8f3db'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_decode_step.onnx', TTS_MODEL_ID, TTS_MODEL_REVISION, 291483, '698cbc2fc1c2feca16e5895614ed52bbb32ded10f236c076f477b2e69abf32d8'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_local_decoder.onnx', TTS_MODEL_ID, TTS_MODEL_REVISION, 49231, '51aa754301b38550a5f9adda0ad93bd3dc95819afb511e6dcabf4a90b345a454'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_local_cached_step.onnx', TTS_MODEL_ID, TTS_MODEL_REVISION, 53685, 'aa9035fefc1c138a951a8bcfc0374fb03a25f1ece67f7f7f53bce349b84a1dd5'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_local_fixed_sampled_frame.onnx', TTS_MODEL_ID, TTS_MODEL_REVISION, 471262, '40cdb00efc171c450cf91468e01429caa41b0252222cd308e978f58fe354afa8'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_global_shared.data', TTS_MODEL_ID, TTS_MODEL_REVISION, 440813568, 'bce8312c3df6a44545302cae229b61054fe0672e0b252ba59cba47adeed831dc'),
  modelFile(TTS_MODEL_DIRECTORY, 'moss_tts_local_shared.data', TTS_MODEL_ID, TTS_MODEL_REVISION, 229678080, 'bae7782032c0fb12490ab42afe009f87ae6c75a0f0596fc7b5c08e4d5ee93916'),
  modelFile(CODEC_MODEL_DIRECTORY, 'codec_browser_onnx_meta.json', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 16461, 'c40eb144a4f50453ac0437944cbdeee1467845b886e90197ff1eada1353303db'),
  modelFile(CODEC_MODEL_DIRECTORY, 'moss_audio_tokenizer_encode.onnx', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 815775, 'eadea4a645abdcf98714c7aead122ee2ce7da6e080f9f80b977cd1ca8e19473a'),
  modelFile(CODEC_MODEL_DIRECTORY, 'moss_audio_tokenizer_encode.data', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 44507136, 'aa751265b2bab2887eac224484546b194875aa7494b607115439b3dc6b228a2c'),
  modelFile(CODEC_MODEL_DIRECTORY, 'moss_audio_tokenizer_decode_full.onnx', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 681902, '0fbbafe3fd4afa2a019af5c5ced204af6e2d1db044fa40f021525d2aee95b4ac'),
  modelFile(CODEC_MODEL_DIRECTORY, 'moss_audio_tokenizer_decode_step.onnx', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 351400, '9527c86a29e1837edec1f74db57d5eeaadb3a715af3382703566460afed25855'),
  modelFile(CODEC_MODEL_DIRECTORY, 'moss_audio_tokenizer_decode_shared.data', CODEC_MODEL_ID, CODEC_MODEL_REVISION, 44198912, 'e69d52e0f4e84ca27850557ee54face46632d3a5a16c89bd246c7c408466dcad'),
]

const ESTIMATED_MODEL_BYTES = MOSS_MODEL_FILES.reduce((total, file) => total + file.sizeBytes, 0)

export function mossTtsModelDownloadUrls(): string[] {
  return MOSS_MODEL_FILES.map((file) => file.url)
}

type ProgressListener = (progress: MossTtsProgress) => void
type PendingRequest = {
  request: MossTtsGenerationRequest
  resolve: (result: MossTtsGenerationResult) => void
  reject: (error: unknown) => void
  listener?: ProgressListener
  controller: AbortController
}
type ServiceMessage = {
  type?: string
  requestId?: string | null
  stage?: string
  fraction?: number | null
  outputPath?: string
  durationSeconds?: number
  message?: string
}

function abortError(): DOMException {
  return new DOMException('MOSS 语音生成已取消。', 'AbortError')
}

function cacheRootForBaseDir(baseDir: string): string {
  return path.resolve(baseDir, 'cache', RUNTIME_FOLDER)
}

function runtimePaths(root: string): {
  downloads: string
  temp: string
  pipCache: string
  pythonCache: string
  pythonBytecode: string
  pythonConfig: string
  pythonState: string
  pythonUserBase: string
  pythonHome: string
  pythonAppData: string
  pythonLocalAppData: string
  output: string
  logs: string
} {
  return {
    downloads: path.join(root, 'downloads'),
    temp: path.join(root, 'downloads', 'tmp'),
    pipCache: path.join(root, 'downloads', 'pip'),
    pythonCache: path.join(root, 'runtime', 'cache'),
    pythonBytecode: path.join(root, 'runtime', 'pycache'),
    pythonConfig: path.join(root, 'runtime', 'config'),
    pythonState: path.join(root, 'runtime', 'state'),
    pythonUserBase: path.join(root, 'runtime', 'userbase'),
    pythonHome: path.join(root, 'runtime', 'home'),
    pythonAppData: path.join(root, 'runtime', 'appdata'),
    pythonLocalAppData: path.join(root, 'runtime', 'localappdata'),
    output: path.join(root, 'generated'),
    logs: path.join(root, 'logs'),
  }
}

function runtimeEnvironment(root: string): NodeJS.ProcessEnv {
  const paths = runtimePaths(root)
  return {
    ...process.env,
    PIP_CACHE_DIR: paths.pipCache,
    TMPDIR: paths.temp,
    TEMP: paths.temp,
    TMP: paths.temp,
    XDG_CACHE_HOME: paths.pythonCache,
    XDG_CONFIG_HOME: paths.pythonConfig,
    XDG_STATE_HOME: paths.pythonState,
    PYTHONPYCACHEPREFIX: paths.pythonBytecode,
    PYTHONUSERBASE: paths.pythonUserBase,
    HOME: paths.pythonHome,
    USERPROFILE: paths.pythonHome,
    APPDATA: paths.pythonAppData,
    LOCALAPPDATA: paths.pythonLocalAppData,
    MOSS_MODEL_ROOT: path.join(root, 'models'),
    MOSS_OUTPUT_ROOT: paths.output,
    MOSS_CACHE_ROOT: root,
    MOSS_LOG_ROOT: paths.logs,
    MOSS_THREADS: String(THREAD_COUNT),
    PYTHONUNBUFFERED: '1',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  }
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function sourceRoot(): string {
  const appRoot = process.env.APP_ROOT ?? path.resolve(__dirname, '..')
  return app.isPackaged
    ? path.join(process.resourcesPath, RUNTIME_FOLDER, 'python')
    : path.join(appRoot, RUNTIME_FOLDER, 'python')
}

async function isModelFileCached(filePath: string, expectedBytes: number): Promise<boolean> {
  return (await stat(filePath).catch(() => null))?.size === expectedBytes
}

async function ensureModels(root: string, report: (stage: string, fraction: number, loaded: number, total: number) => void, signal?: AbortSignal): Promise<void> {
  const modelRoot = path.join(root, 'models')
  const totalBytes = ESTIMATED_MODEL_BYTES
  const cachedManifest = await readFile(path.join(modelRoot, 'manifest.json'), 'utf8')
    .then((text) => JSON.parse(text) as { ttsRevision?: string; codecRevision?: string; sourceRevision?: string })
    .catch(() => null)
  if (
    cachedManifest?.ttsRevision === TTS_MODEL_REVISION
    && cachedManifest.codecRevision === CODEC_MODEL_REVISION
    && cachedManifest.sourceRevision === SOURCE_REVISION
    && await modelsCached(root)
  ) {
    report('preparing-model', 1, totalBytes, totalBytes)
    return
  }
  let completedBytes = 0
  for (const definition of MOSS_MODEL_FILES) {
    signal?.throwIfAborted()
    const destinationDir = path.join(modelRoot, definition.directory)
    const fileProgress = (progress: ModelFileProgress) => {
      const loadedBytes = completedBytes + progress.completedBytes
      report('downloading-model', loadedBytes / totalBytes, loadedBytes, totalBytes)
    }
    await loadVerifiedModelFile(destinationDir, definition, {
      signal,
      onProgress: fileProgress,
    })
    completedBytes += definition.sizeBytes
    report('downloading-model', completedBytes / totalBytes, completedBytes, totalBytes)
  }
  await writeFile(path.join(modelRoot, 'manifest.json'), JSON.stringify({
    ttsModelId: TTS_MODEL_ID,
    ttsRevision: TTS_MODEL_REVISION,
    codecModelId: CODEC_MODEL_ID,
    codecRevision: CODEC_MODEL_REVISION,
    sourceRevision: SOURCE_REVISION,
    files: MOSS_MODEL_FILES.map(({ directory, fileName, sizeBytes, sha256 }) => ({ directory, fileName, sizeBytes, sha256 })),
  }, null, 2), 'utf8')
}

async function modelsCached(root: string): Promise<boolean> {
  return Promise.all(MOSS_MODEL_FILES.map(async (definition) => isModelFileCached(
    path.join(root, 'models', definition.directory, definition.fileName),
    definition.sizeBytes,
  ))).then((values) => values.every(Boolean))
}

class MossTtsRuntime {
  private process: ChildProcessWithoutNullStreams | null = null
  private processRoot: string | null = null
  private stdoutBuffer = ''
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((error: unknown) => void) | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Set<ProgressListener>()

  addListener(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emitProgress(message: ServiceMessage, pending?: PendingRequest): void {
    if (!message.requestId || !pending) return
    const progress: MossTtsProgress = {
      requestId: message.requestId,
      stage: message.stage ?? '正在处理语音。',
      fraction: typeof message.fraction === 'number' ? Math.max(0, Math.min(1, message.fraction)) : null,
    }
    pending.listener?.(progress)
    for (const listener of this.listeners) listener(progress)
  }

  private handleMessage(message: ServiceMessage): void {
    if (message.type === 'ready') {
      const resolve = this.readyResolve
      this.readyResolve = null
      this.readyReject = null
      resolve?.()
      return
    }
    const requestId = typeof message.requestId === 'string' ? message.requestId : null
    const pending = requestId ? this.pending.get(requestId) : undefined
    if (!requestId || !pending) return
    if (message.type === 'progress') {
      this.emitProgress(message, pending)
      return
    }
    this.pending.delete(requestId)
    if (message.type === 'cancelled') {
      pending.reject(abortError())
      return
    }
    if (message.type === 'error') {
      pending.reject(new Error(message.message || 'MOSS 语音生成失败。'))
      return
    }
    if (message.type === 'completed') {
      const outputPath = typeof message.outputPath === 'string' ? path.resolve(message.outputPath) : ''
      const outputRoot = this.processRoot ? runtimePaths(this.processRoot).output : ''
      if (!outputPath || !outputRoot || !isPathInside(outputRoot, outputPath)) {
        pending.reject(new Error('MOSS 返回了无效的语音文件。'))
        return
      }
      void readFile(outputPath)
        .then((bytes) => pending.resolve({
          requestId,
          fileName: path.basename(outputPath),
          durationSeconds: Number(message.durationSeconds ?? 0),
          bytes: new Uint8Array(bytes),
        }))
        .catch(pending.reject)
    }
  }

  private attachProcess(child: ChildProcessWithoutNullStreams, root: string): void {
    this.process = child
    this.processRoot = root
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk
      let newline = this.stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = this.stdoutBuffer.slice(0, newline).trim()
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
        newline = this.stdoutBuffer.indexOf('\n')
        if (!line) continue
        try {
          this.handleMessage(JSON.parse(line) as ServiceMessage)
        } catch (error) {
          logMainWarn('[moss-tts] 忽略无法解析的服务消息', { error: String(error) })
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (message) logMainInfo('[moss-tts] Python 服务', { message })
    })
    child.once('error', (error) => this.failProcess(error))
    child.once('close', (code, signal) => {
      if (this.process === child) this.failProcess(new Error(`MOSS 服务已退出 (${code ?? signal ?? 'unknown'})`))
    })
  }

  private failProcess(error: Error): void {
    this.readyReject?.(error)
    this.readyPromise = null
    this.readyResolve = null
    this.readyReject = null
    this.process = null
    this.processRoot = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  private async ensureProcess(
    root: string,
    report: (stage: string, fraction?: number, loaded?: number, total?: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.process && this.processRoot === root && this.readyPromise) return this.readyPromise
    if (this.process) await this.unload()
    const python = await resolvePythonCommand()
    await ensureModels(root, (stage, fraction, loaded, total) => report(stage, fraction, loaded, total), signal)
    signal.throwIfAborted()
    const script = path.join(sourceRoot(), 'scripts', 'luna_service.py')
    const paths = runtimePaths(root)
    await mkdir(root, { recursive: true })
    await Promise.all(Object.values(paths).map((directory) => mkdir(directory, { recursive: true })))
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })
    const child = spawn(python.command, [...python.args, script], {
      cwd: root,
      env: runtimeEnvironment(root),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.attachProcess(child, root)
    await this.readyPromise
  }

  async generate(request: MossTtsGenerationRequest, listener?: ProgressListener): Promise<MossTtsGenerationResult> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) throw new Error('语音任务编号无效。')
    if (this.pending.has(request.requestId)) throw new Error('语音任务编号已在使用。')
    const settings = await getSettings()
    const root = cacheRootForBaseDir(settings.baseDir)
    const controller = new AbortController()
    let rejectPending: (error: unknown) => void = () => {}
    const pending = new Promise<MossTtsGenerationResult>((resolve, reject) => {
      rejectPending = reject
      this.pending.set(request.requestId, { request, resolve, reject, listener, controller })
    })
    const report = (stage: string, fraction?: number, loadedBytes?: number, totalBytes?: number) => {
      const current = this.pending.get(request.requestId)
      if (!current) return
      const progress: MossTtsProgress = {
        requestId: request.requestId,
        stage,
        fraction: typeof fraction === 'number' ? Math.max(0, Math.min(1, fraction)) : null,
        ...(typeof loadedBytes === 'number' ? { loadedBytes } : {}),
        ...(typeof totalBytes === 'number' ? { totalBytes } : {}),
      }
      current.listener?.(progress)
      for (const currentListener of this.listeners) currentListener(progress)
    }
    void (async () => {
      try {
        await this.ensureProcess(root, report, controller.signal)
        controller.signal.throwIfAborted()
        if (!this.process) throw new Error('MOSS 服务未启动。')
        const outputPath = path.join(runtimePaths(root).output, `${request.requestId}.wav`)
        if (!isPathInside(runtimePaths(root).output, outputPath)) throw new Error('语音输出位置无效。')
        await rm(outputPath, { force: true })
        this.process.stdin.write(JSON.stringify({ ...request, type: 'generate', outputPath }) + '\n')
      } catch (error) {
        this.pending.delete(request.requestId)
        rejectPending(error)
      }
    })()
    return pending
  }

  async prepare(listener?: ProgressListener): Promise<void> {
    if (this.pending.size > 0) throw new Error('当前正在生成语音，请完成后再准备模型。')
    const settings = await getSettings()
    const root = cacheRootForBaseDir(settings.baseDir)
    if (!(await hasPythonRuntime())) throw new Error('当前环境无法使用 MOSS 语音。')
    await resolvePythonCommand()
    const requestId = `prepare_${Date.now()}`
    const controller = new AbortController()
    await ensureModels(root, (stage, fraction, loaded, total) => {
      listener?.({
        requestId,
        stage,
        fraction: Math.max(0, Math.min(1, fraction)),
        loadedBytes: loaded,
        totalBytes: total,
      })
    }, controller.signal)
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId)
    pending?.controller.abort()
    if (pending && this.process) {
      this.process.stdin.write(JSON.stringify({ type: 'cancel', requestId }) + '\n')
    }
  }

  async unload(): Promise<void> {
    const child = this.process
    if (!child) return
    const error = abortError()
    for (const pending of this.pending.values()) {
      pending.controller.abort()
      pending.reject(error)
    }
    this.pending.clear()
    child.kill()
    this.failProcess(error)
  }

  async status(): Promise<MossTtsStatus> {
    const settings = await getSettings()
    const root = cacheRootForBaseDir(settings.baseDir)
    const environment = await hasPythonRuntime()
      ? (await modelsCached(root) ? 'ready' : 'missing-model')
      : 'missing-python'
    return {
      supported: environment !== 'missing-python',
      environment,
      cacheRoot: root,
      modelCached: await modelsCached(root),
      estimatedBytes: ESTIMATED_MODEL_BYTES,
    }
  }
}

export const mossTtsRuntime = new MossTtsRuntime()

export async function shutdownMossTts(): Promise<void> {
  await mossTtsRuntime.unload()
}
