import { app } from 'electron'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpus } from 'node:os'
import type {
  StableAudio3GenerationRequest,
  StableAudio3GenerationResult,
  StableAudio3ModelId,
  StableAudio3ModelStatus,
  StableAudio3Progress,
  StableAudio3Status,
} from '../src/shared/types'
import { getSettings } from './settingsService'
import { logMainInfo, logMainWarn } from './loggerService'
import { hasPythonRuntime, resolvePythonCommand } from './pythonRuntime'

const RUNTIME_FOLDER = 'stable-audio-3'
const MODEL_ROOT_ENV = 'SA3_MODEL_ROOT'
const WORK_ROOT_ENV = 'SA3_WORK_ROOT'
const DOWNLOAD_ROOT_ENV = 'SA3_DOWNLOAD_ROOT'
const OUTPUT_ROOT_ENV = 'SA3_OUTPUT_ROOT'
const LORA_ROOT_ENV = 'SA3_LORA_ROOT'
const LORA_CACHE_ROOT_ENV = 'SA3_LORA_CACHE_ROOT'
const LOG_ROOT_ENV = 'SA3_LOG_ROOT'
const CACHE_ROOT_ENV = 'SA3_CACHE_ROOT'
const MODEL_FILES: Record<StableAudio3ModelId, { label: string; ditBytes: number }> = {
  'small-music': { label: '背景音乐', ditBytes: 1_838_758_544 },
  'small-sfx': { label: '音效', ditBytes: 1_838_758_544 },
}
const SHARED_MODEL_BYTES = 1_001_631_971

type ProgressListener = (progress: StableAudio3Progress) => void
type PendingRequest = {
  request: StableAudio3GenerationRequest
  resolve: (result: StableAudio3GenerationResult) => void
  reject: (error: unknown) => void
  listener?: ProgressListener
}
type ServiceMessage = {
  type?: string
  requestId?: string | null
  stage?: string
  fraction?: number | null
  file?: string | null
  loadedBytes?: number | null
  totalBytes?: number | null
  outputPath?: string
  durationSeconds?: number
  model?: StableAudio3ModelId
  message?: string
}

function isModelId(value: unknown): value is StableAudio3ModelId {
  return value === 'small-music' || value === 'small-sfx'
}

function abortError(): DOMException {
  return new DOMException('Stable Audio generation cancelled.', 'AbortError')
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
  huggingfaceCache: string
  gradioTemp: string
  matplotlibConfig: string
  numbaCache: string
  uvCache: string
  output: string
  loras: string
  loraCache: string
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
    huggingfaceCache: path.join(root, 'runtime', 'huggingface'),
    gradioTemp: path.join(root, 'runtime', 'gradio-temp'),
    matplotlibConfig: path.join(root, 'runtime', 'matplotlib'),
    numbaCache: path.join(root, 'runtime', 'numba'),
    uvCache: path.join(root, 'downloads', 'uv'),
    output: path.join(root, 'generated'),
    loras: path.join(root, 'loras'),
    loraCache: path.join(root, 'lora-cache'),
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
    HF_HOME: paths.huggingfaceCache,
    HUGGINGFACE_HUB_CACHE: path.join(paths.huggingfaceCache, 'hub'),
    TRANSFORMERS_CACHE: path.join(paths.huggingfaceCache, 'transformers'),
    TORCH_HOME: path.join(paths.huggingfaceCache, 'torch'),
    GRADIO_TEMP_DIR: paths.gradioTemp,
    MPLCONFIGDIR: paths.matplotlibConfig,
    NUMBA_CACHE_DIR: paths.numbaCache,
    UV_CACHE_DIR: paths.uvCache,
    [CACHE_ROOT_ENV]: root,
    [MODEL_ROOT_ENV]: root,
    [WORK_ROOT_ENV]: root,
    [DOWNLOAD_ROOT_ENV]: paths.downloads,
    [OUTPUT_ROOT_ENV]: paths.output,
    [LORA_ROOT_ENV]: paths.loras,
    [LORA_CACHE_ROOT_ENV]: paths.loraCache,
    [LOG_ROOT_ENV]: paths.logs,
    SA3_JSONL: '1',
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
    ? path.join(process.resourcesPath, RUNTIME_FOLDER, 'tflite')
    : path.join(appRoot, RUNTIME_FOLDER, 'tflite')
}

class StableAudio3Runtime {
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
    if (!message.requestId || !pending || !isModelId(message.model ?? pending.request.model)) return
    const progress: StableAudio3Progress = {
      requestId: message.requestId,
      model: message.model ?? pending.request.model,
      stage: message.stage ?? '正在处理音频。',
      fraction: typeof message.fraction === 'number' ? Math.max(0, Math.min(1, message.fraction)) : null,
      ...(message.file ? { file: message.file } : {}),
      ...(typeof message.loadedBytes === 'number' ? { loadedBytes: message.loadedBytes } : {}),
      ...(typeof message.totalBytes === 'number' ? { totalBytes: message.totalBytes } : {}),
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
      pending.reject(new Error(message.message || 'Stable Audio 3 生成失败。'))
      return
    }
    if (message.type === 'completed') {
      const outputPath = typeof message.outputPath === 'string' ? path.resolve(message.outputPath) : ''
      const outputRoot = this.processRoot ? path.join(this.processRoot, 'generated') : ''
      if (!outputPath || !outputRoot || !isPathInside(outputRoot, outputPath)) {
        pending.reject(new Error('Stable Audio 3 返回了无效的音频文件。'))
        return
      }
      void readFile(outputPath)
        .then((bytes) => pending.resolve({
          requestId,
          model: pending.request.model,
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
          logMainWarn('[stable-audio] 忽略无法解析的服务消息', { error: String(error) })
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (message) logMainInfo('[stable-audio] Python 服务', { message })
    })
    child.once('error', (error) => this.failProcess(error))
    child.once('close', (code, signal) => {
      if (this.process === child) this.failProcess(new Error(`Stable Audio 服务已退出 (${code ?? signal ?? 'unknown'})`))
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

  private async ensureProcess(root: string): Promise<void> {
    if (this.process && this.processRoot === root && this.readyPromise) return this.readyPromise
    if (this.process) await this.unload()
    const python = await resolvePythonCommand()
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
      env: {
        ...runtimeEnvironment(root),
        PYTHONUNBUFFERED: '1',
        SA3_THREADS: String(Math.min(8, Math.max(1, cpus().length))),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.attachProcess(child, root)
    await this.readyPromise
  }

  async generate(request: StableAudio3GenerationRequest, listener?: ProgressListener): Promise<StableAudio3GenerationResult> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(request.requestId)) {
      throw new Error('音频任务编号无效。')
    }
    if (this.pending.has(request.requestId)) {
      throw new Error('音频任务编号已在使用。')
    }
    const settings = await getSettings()
    const root = cacheRootForBaseDir(settings.baseDir)
    await this.ensureProcess(root)
    if (!this.process) throw new Error('Stable Audio 服务未启动。')
    const outputPath = path.join(runtimePaths(root).output, `${request.requestId}.wav`)
    if (!isPathInside(runtimePaths(root).output, outputPath)) {
      throw new Error('音频输出位置无效。')
    }
    await rm(outputPath, { force: true })
    const pending = new Promise<StableAudio3GenerationResult>((resolve, reject) => {
      this.pending.set(request.requestId, { request, resolve, reject, listener })
    })
    try {
      this.process.stdin.write(JSON.stringify({ ...request, type: 'generate', outputPath }) + '\n')
    } catch (error) {
      this.pending.delete(request.requestId)
      throw error
    }
    return pending
  }

  cancel(requestId: string): void {
    const pending = this.pending.get(requestId)
    if (!pending || !this.process) return
    this.process.stdin.write(JSON.stringify({ type: 'cancel', requestId }) + '\n')
  }

  async unload(): Promise<void> {
    const child = this.process
    if (!child) return
    const error = abortError()
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    child.kill()
    this.failProcess(error)
  }

  async status(): Promise<StableAudio3Status> {
    const settings = await getSettings()
    const root = cacheRootForBaseDir(settings.baseDir)
    const environment = await hasPythonRuntime()
      ? 'ready'
      : 'missing-python'
    const models: StableAudio3ModelStatus[] = await Promise.all(
      (Object.keys(MODEL_FILES) as StableAudio3ModelId[]).map(async (id) => {
        const ditPath = path.join(root, 'models', 'tflite', id === 'small-music' ? 'sa3-sm-music' : 'sa3-sm-sfx', 'dit_fp32.tflite')
        const cached = (await stat(ditPath).catch(() => null))?.size === MODEL_FILES[id].ditBytes
          && (await stat(path.join(root, 'models', 'tokenizer.model')).catch(() => null))?.size === 4_241_003
        return {
          id,
          label: MODEL_FILES[id].label,
          estimatedBytes: SHARED_MODEL_BYTES + MODEL_FILES[id].ditBytes,
          cached,
        }
      }),
    )
    return {
      supported: environment !== 'missing-python',
      environment,
      cacheRoot: root,
      models,
    }
  }
}

export const stableAudio3Runtime = new StableAudio3Runtime()

export async function shutdownStableAudio3(): Promise<void> {
  await stableAudio3Runtime.unload()
}
