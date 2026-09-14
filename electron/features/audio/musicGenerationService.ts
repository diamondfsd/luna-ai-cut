import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { loadMusicGenModelDirectory, getMusicGenModelStatus, type MusicGenModelStatus } from './musicGenModelService'

const MAX_TASKS = 20
const START_TIMEOUT_MS = 10 * 60 * 1_000
const GENERATED_AUDIO_DIRECTORY = 'generated-audio'

export interface MusicGenerationRequest {
  prompt: string
  durationSec: number
  outputPath?: string
}

export interface MusicGenerationResult {
  taskId: string
  status: 'completed'
  outputPath: string
  sampleRate: number
  sampleCount: number
  durationSec: number
  inferenceMs: number
}

export interface MusicGenerationTaskStatus {
  taskId: string
  status: 'starting' | 'generating' | 'completed' | 'failed' | 'cancelled'
  progress: number
  prompt: string
  durationSec: number
  outputPath: string
  error?: string
  result?: MusicGenerationResult
}

interface WorkerReady {
  type: 'ready'
  modelLoadMs: number
  sampleRate: number
}

interface WorkerProgress {
  type: 'progress'
  requestId: string
  generatedTokens: number
  totalTokens: number
}

interface WorkerComplete {
  type: 'complete'
  requestId: string
  outputPath: string
  sampleRate: number
  sampleCount: number
  durationSec: number
  inferenceMs: number
}

interface WorkerError {
  type: 'error'
  requestId?: string
  error: string
}

type WorkerEvent = WorkerReady | WorkerProgress | WorkerComplete | WorkerError

interface RuntimeTask {
  snapshot: MusicGenerationTaskStatus
  child?: ChildProcessWithoutNullStreams
  abortController: AbortController
  stdout: string
  stderr: string
  ready: boolean
  settled: boolean
  completing: boolean
  readyResolve: () => void
  readyReject: (error: Error) => void
  completion: Promise<MusicGenerationResult>
  resolve: (result: MusicGenerationResult) => void
  reject: (error: Error) => void
}

function appRoot(): string {
  return process.env.APP_ROOT ?? path.join(import.meta.dirname, '..')
}

function workerPath(): string {
  const name = process.platform === 'win32' ? 'musicgen-worker.exe' : 'musicgen-worker'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', name)
    : path.join(appRoot(), 'luna-render-core', name)
}

function defaultOutputPath(): string {
  return path.join(app.getPath('userData'), GENERATED_AUDIO_DIRECTORY, `musicgen-${randomUUID()}.wav`)
}

function isWithinDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function normalizeRequest(request: MusicGenerationRequest): Required<MusicGenerationRequest> {
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.trim().length > 2_000) {
    throw new Error('音乐描述不能为空且不能超过 2000 字')
  }
  if (!Number.isFinite(request.durationSec) || request.durationSec < 1 || request.durationSec > 30) {
    throw new Error('音乐时长必须在 1 到 30 秒之间')
  }
  const outputPath = path.resolve(request.outputPath?.trim() || defaultOutputPath())
  if (path.extname(outputPath).toLowerCase() !== '.wav') throw new Error('音乐输出文件必须使用 WAV 格式')
  if (!isWithinDirectory(path.join(app.getPath('userData'), GENERATED_AUDIO_DIRECTORY), outputPath)) {
    throw new Error('音乐输出文件必须位于本地生成音频目录')
  }
  return { prompt: request.prompt.trim(), durationSec: request.durationSec, outputPath }
}

function parseWorkerEvent(raw: string): WorkerEvent {
  const value = JSON.parse(raw) as Record<string, unknown>
  if (value.type === 'ready' && typeof value.modelLoadMs === 'number' && typeof value.sampleRate === 'number') {
    return { type: 'ready', modelLoadMs: value.modelLoadMs, sampleRate: value.sampleRate }
  }
  if (
    value.type === 'progress'
    && typeof value.requestId === 'string'
    && typeof value.generatedTokens === 'number'
    && typeof value.totalTokens === 'number'
  ) {
    return {
      type: 'progress',
      requestId: value.requestId,
      generatedTokens: value.generatedTokens,
      totalTokens: value.totalTokens,
    }
  }
  if (
    value.type === 'complete'
    && typeof value.requestId === 'string'
    && typeof value.outputPath === 'string'
    && typeof value.sampleRate === 'number'
    && typeof value.sampleCount === 'number'
    && typeof value.durationSec === 'number'
    && typeof value.inferenceMs === 'number'
  ) {
    return {
      type: 'complete',
      requestId: value.requestId,
      outputPath: value.outputPath,
      sampleRate: value.sampleRate,
      sampleCount: value.sampleCount,
      durationSec: value.durationSec,
      inferenceMs: value.inferenceMs,
    }
  }
  if (value.type === 'error' && typeof value.error === 'string') {
    return { type: 'error', requestId: typeof value.requestId === 'string' ? value.requestId : undefined, error: value.error }
  }
  throw new Error('MusicGen worker 返回了无效结果')
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.killed) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill('SIGKILL')
  }, 1_500)
  timer.unref()
}

export class MusicGenerationService {
  private readonly tasks = new Map<string, MusicGenerationTaskStatus>()
  private readonly runtimes = new Map<string, RuntimeTask>()
  private modelPreparation: Promise<void> = Promise.resolve()

  async getStatus(): Promise<{ model: MusicGenModelStatus; tasks: MusicGenerationTaskStatus[] }> {
    return {
      model: await getMusicGenModelStatus(),
      tasks: [...this.tasks.values()].slice(-MAX_TASKS).map((task) => ({ ...task, result: task.result ? { ...task.result } : undefined })),
    }
  }

  getTask(taskId: string): MusicGenerationTaskStatus | null {
    const task = this.tasks.get(taskId)
    return task ? { ...task, result: task.result ? { ...task.result } : undefined } : null
  }

  async start(request: MusicGenerationRequest): Promise<MusicGenerationTaskStatus> {
    const normalized = normalizeRequest(request)
    await mkdir(path.dirname(normalized.outputPath), { recursive: true })
    const taskId = randomUUID()
    const snapshot: MusicGenerationTaskStatus = {
      taskId,
      status: 'starting',
      progress: 0,
      prompt: normalized.prompt,
      durationSec: normalized.durationSec,
      outputPath: normalized.outputPath,
    }
    this.tasks.set(taskId, snapshot)
    this.trimTasks()

    let resolveCompletion!: (result: MusicGenerationResult) => void
    let rejectCompletion!: (error: Error) => void
    const completion = new Promise<MusicGenerationResult>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })
    const runtime: RuntimeTask = {
      snapshot,
      abortController: new AbortController(),
      child: undefined,
      stdout: '',
      stderr: '',
      ready: false,
      settled: false,
      completing: false,
      readyResolve: () => undefined,
      readyReject: () => undefined,
      completion,
      resolve: resolveCompletion,
      reject: rejectCompletion,
    }
    this.runtimes.set(taskId, runtime)
    void completion.catch(() => undefined)

    void this.run(runtime, normalized)
    return { ...snapshot }
  }

  private async run(runtime: RuntimeTask, normalized: Required<MusicGenerationRequest>): Promise<void> {
    const timeout = setTimeout(() => {
      if (!runtime.ready) this.fail(runtime, new Error('MusicGen 模型加载超时'))
      else if (!runtime.settled) this.fail(runtime, new Error('MusicGen 生成超时'))
    }, START_TIMEOUT_MS)
    timeout.unref()

    let readyResolve!: () => void
    let readyReject!: (error: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    runtime.readyResolve = readyResolve
    runtime.readyReject = readyReject

    try {
      const modelDir = await this.prepareModel(runtime)
      if (runtime.settled) return

      const child = spawn(workerPath(), ['--serve', modelDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      runtime.child = child
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { runtime.stderr = `${runtime.stderr}${chunk}`.slice(-16 * 1024) })
      child.stdout.on('data', (chunk: string) => this.consumeOutput(runtime, chunk))
      child.once('error', (error) => {
        if (!runtime.ready) readyReject(new Error(`无法启动 MusicGen：${error.message}`))
        this.fail(runtime, new Error(`无法启动 MusicGen：${error.message}`))
      })
      child.once('close', (code, signal) => {
        if (!runtime.ready) readyReject(new Error(runtime.stderr.trim() || 'MusicGen 模型启动失败'))
        if (!runtime.settled) this.fail(runtime, new Error(runtime.stderr.trim() || `MusicGen worker 已退出（${code ?? signal ?? '未知原因'}）`))
        this.runtimes.delete(runtime.snapshot.taskId)
      })

      await ready
      if (runtime.settled) return
      child.stdin.write(`${JSON.stringify({
        type: 'generate',
        requestId: runtime.snapshot.taskId,
        prompt: normalized.prompt,
        durationSec: normalized.durationSec,
        outputPath: normalized.outputPath,
      })}\n`)
    } catch (error) {
      if (runtime.snapshot.status === 'cancelled') return
      this.fail(runtime, error instanceof Error ? error : new Error('MusicGen 任务失败'))
    } finally {
      clearTimeout(timeout)
      if (!runtime.child) this.runtimes.delete(runtime.snapshot.taskId)
    }
  }

  private prepareModel(runtime: RuntimeTask): Promise<string> {
    const previous = this.modelPreparation.catch(() => undefined)
    let release!: () => void
    this.modelPreparation = new Promise<void>((resolve) => { release = resolve })
    return previous.then(async () => {
      try {
        if (runtime.settled) throw new Error('音乐任务已取消')
        return await loadMusicGenModelDirectory({
          signal: runtime.abortController.signal,
          onProgress: ({ completedBytes, totalBytes }) => {
            if (runtime.settled) return
            runtime.snapshot.status = 'starting'
            runtime.snapshot.progress = totalBytes > 0
              ? Math.min(49, Math.round(completedBytes / totalBytes * 49))
              : 0
          },
        })
      } finally {
        release()
      }
    })
  }

  async generate(request: MusicGenerationRequest): Promise<MusicGenerationResult> {
    const task = await this.start(request)
    const runtime = this.runtimes.get(task.taskId)
    if (!runtime) throw new Error('MusicGen 任务已结束')
    return runtime.completion
  }

  cancel(taskId: string): MusicGenerationTaskStatus {
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('MusicGen 任务不存在')
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return { ...task }
    task.status = 'cancelled'
    task.progress = 0
    task.error = '音乐生成已取消'
    const runtime = this.runtimes.get(taskId)
    if (runtime && !runtime.settled) {
      runtime.settled = true
      runtime.reject(new Error(task.error))
      runtime.abortController.abort()
      if (runtime.child) terminate(runtime.child)
    }
    return { ...task }
  }

  private consumeOutput(runtime: RuntimeTask, chunk: string): void {
    runtime.stdout += chunk
    for (;;) {
      const newline = runtime.stdout.indexOf('\n')
      if (newline < 0) return
      const line = runtime.stdout.slice(0, newline).trim()
      runtime.stdout = runtime.stdout.slice(newline + 1)
      if (!line) continue
      let event: WorkerEvent
      try {
        event = parseWorkerEvent(line)
      } catch (error) {
        this.fail(runtime, new Error(errorMessage(error, 'MusicGen worker 响应无效')))
        return
      }
      this.handleEvent(runtime, event)
    }
  }

  private handleEvent(runtime: RuntimeTask, event: WorkerEvent): void {
    if (event.type === 'ready') {
      runtime.ready = true
      runtime.snapshot.status = 'generating'
      runtime.readyResolve()
      return
    }
    if (event.type === 'progress') {
      if (event.requestId !== runtime.snapshot.taskId) return
      runtime.snapshot.status = 'generating'
      runtime.snapshot.progress = event.totalTokens > 0
        ? Math.min(99, Math.round(event.generatedTokens / event.totalTokens * 100))
        : 0
      return
    }
    if (event.type === 'error') {
      if (!event.requestId || event.requestId === runtime.snapshot.taskId) this.fail(runtime, new Error(event.error))
      return
    }
    if (event.requestId !== runtime.snapshot.taskId || runtime.settled || runtime.completing) return
    runtime.completing = true
    void this.complete(runtime, event)
  }

  private async complete(runtime: RuntimeTask, event: WorkerComplete): Promise<void> {
    try {
      const info = await stat(event.outputPath)
      if (!info.isFile() || info.size === 0) throw new Error('MusicGen 输出文件为空')
    } catch (error) {
      runtime.completing = false
      this.fail(runtime, error instanceof Error ? error : new Error('MusicGen 输出文件不存在'))
      return
    }
    runtime.completing = false
    if (runtime.settled) return
    runtime.snapshot.status = 'completed'
    runtime.snapshot.progress = 100
    const result: MusicGenerationResult = {
      taskId: runtime.snapshot.taskId,
      status: 'completed',
      outputPath: event.outputPath,
      sampleRate: event.sampleRate,
      sampleCount: event.sampleCount,
      durationSec: event.durationSec,
      inferenceMs: event.inferenceMs,
    }
    runtime.snapshot.result = result
    runtime.settled = true
    runtime.resolve(result)
    runtime.child?.stdin.end()
  }

  private fail(runtime: RuntimeTask, error: Error): void {
    if (runtime.settled) return
    runtime.snapshot.status = 'failed'
    runtime.snapshot.error = error.message
    runtime.settled = true
    runtime.abortController.abort()
    runtime.readyReject(error)
    runtime.reject(error)
    if (runtime.child) terminate(runtime.child)
  }

  private trimTasks(): void {
    while (this.tasks.size > MAX_TASKS) {
      const oldest = this.tasks.keys().next().value
      if (typeof oldest !== 'string') return
      this.tasks.delete(oldest)
    }
  }
}

export const musicGenerationService = new MusicGenerationService()
