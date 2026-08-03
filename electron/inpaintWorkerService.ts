import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { loadInpaintModel } from './inpaintModelService'

export interface InpaintWorkerMetrics {
  modelLoadMs: number
  inferenceMs: number
  regionCount: number
}

interface WorkerMessage {
  kind?: unknown
  requestId?: unknown
  modelLoadMs?: unknown
  inferenceMs?: unknown
  regionCount?: unknown
  error?: unknown
}

interface PendingRequest {
  resolve: (metrics: InpaintWorkerMetrics) => void
  reject: (error: Error) => void
  removeAbortListener: () => void
}

function appRoot(): string {
  return process.env.APP_ROOT ?? path.join(import.meta.dirname, '..')
}

function workerPath(): string {
  const name = process.platform === 'win32' ? 'luna-inpaint-worker.exe' : 'luna-inpaint-worker'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', name)
    : path.join(appRoot(), 'luna-render-core', name)
}

function workerStoppedError(): Error {
  return new Error('消除模型已释放')
}

class InpaintWorkerService {
  private readonly owners = new Set<number>()
  private readonly pending = new Map<string, PendingRequest>()
  private worker: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<void> | null = null
  private startupController: AbortController | null = null
  private generation = 0

  async acquire(ownerId: number): Promise<void> {
    this.owners.add(ownerId)
    await this.ensureStarted()
  }

  release(ownerId: number): void {
    this.owners.delete(ownerId)
    if (this.owners.size === 0) this.stop(workerStoppedError())
  }

  async run(ownerId: number, manifestPath: string, signal?: AbortSignal): Promise<InpaintWorkerMetrics> {
    // Keep direct calls compatible while the panel warm-up IPC is still in flight.
    this.owners.add(ownerId)
    await this.ensureStarted()
    signal?.throwIfAborted()
    const worker = this.worker
    if (!worker) throw new Error('消除模型尚未准备完成')
    const requestId = randomUUID()

    return new Promise<InpaintWorkerMetrics>((resolve, reject) => {
      const onAbort = (): void => {
        this.stop(new Error('消除任务已取消'))
        if (this.owners.size > 0) void this.ensureStarted().catch(() => undefined)
      }
      const finish = (callback: () => void): void => {
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      this.pending.set(requestId, {
        resolve: (metrics) => finish(() => resolve(metrics)),
        reject: (error) => finish(() => reject(error)),
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      worker.stdin.write(`${JSON.stringify({ requestId, manifestPath })}\n`, (error) => {
        if (!error) return
        const pending = this.pending.get(requestId)
        if (!pending) return
        this.pending.delete(requestId)
        pending.reject(new Error('无法启动消除任务'))
      })
    })
  }

  private async ensureStarted(): Promise<void> {
    if (this.starting) return this.starting
    if (this.worker) return
    const generation = this.generation
    const controller = new AbortController()
    const starting = this.startWorker(generation, controller.signal)
    this.starting = starting
    this.startupController = controller
    try {
      await starting
    } finally {
      if (this.starting === starting) {
        this.starting = null
        this.startupController = null
      }
    }
  }

  private async startWorker(generation: number, signal: AbortSignal): Promise<void> {
    const modelPath = await loadInpaintModel(signal)
    if (generation !== this.generation || this.owners.size === 0) throw workerStoppedError()
    const worker = spawn(workerPath(), ['--serve', modelPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.worker = worker
    let stderr = ''
    worker.stderr.setEncoding('utf8')
    worker.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-64 * 1024)
    })

    await new Promise<void>((resolve, reject) => {
      let ready = false
      let stdout = ''
      const fail = (error: Error): void => {
        if (this.worker === worker) this.worker = null
        this.rejectPending(error)
        if (!ready) reject(error)
      }
      worker.once('error', () => fail(new Error('无法启动消除模型')))
      worker.once('close', (code) => {
        const detail = stderr.trim()
        fail(new Error(detail || (code === 0 ? '消除模型已关闭' : '消除模型运行失败')))
      })
      worker.stdout.setEncoding('utf8')
      worker.stdout.on('data', (chunk: string) => {
        stdout += chunk
        let newline = stdout.indexOf('\n')
        while (newline >= 0) {
          const line = stdout.slice(0, newline).trim()
          stdout = stdout.slice(newline + 1)
          newline = stdout.indexOf('\n')
          if (!line) continue
          let message: WorkerMessage
          try {
            message = JSON.parse(line) as WorkerMessage
          } catch {
            this.stop(new Error('消除模型返回了无效结果'))
            return
          }
          if (message.kind === 'ready') {
            ready = true
            resolve()
            continue
          }
          this.handleResult(message)
        }
      })
    })
  }

  private handleResult(message: WorkerMessage): void {
    if (message.kind !== 'result' || typeof message.requestId !== 'string') return
    const pending = this.pending.get(message.requestId)
    if (!pending) return
    this.pending.delete(message.requestId)
    if (typeof message.error === 'string' && message.error) {
      pending.reject(new Error(message.error))
      return
    }
    const modelLoadMs = Number(message.modelLoadMs)
    const inferenceMs = Number(message.inferenceMs)
    const regionCount = Number(message.regionCount)
    if (![modelLoadMs, inferenceMs, regionCount].every(Number.isFinite)) {
      pending.reject(new Error('消除模型返回了无效结果'))
      return
    }
    pending.resolve({ modelLoadMs, inferenceMs, regionCount })
  }

  private stop(error: Error): void {
    this.generation += 1
    this.startupController?.abort()
    this.startupController = null
    const worker = this.worker
    this.worker = null
    this.starting = null
    this.rejectPending(error)
    if (worker && !worker.killed) worker.kill()
  }

  private rejectPending(error: Error): void {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const request of pending) {
      request.removeAbortListener()
      request.reject(error)
    }
  }
}

export const inpaintWorkerService = new InpaintWorkerService()
