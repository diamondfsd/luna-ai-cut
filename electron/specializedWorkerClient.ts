import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export interface SpecializedWorkerResult {
  kind: 'result'
  id: string
  sessionLoadMs: number
  inferenceMs: number
  sessionReused: boolean
}

interface SpecializedWorkerError {
  kind: 'error'
  id: string
  error: string
}

interface PendingRequest {
  resolve: (result: SpecializedWorkerResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  signal?: AbortSignal
  abortListener?: () => void
}

export interface SpecializedWorkerLaunch {
  executable: string
  args: string[]
}

function errorFromReason(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

function parseResponse(line: string): SpecializedWorkerResult | SpecializedWorkerError {
  const value: unknown = JSON.parse(line)
  if (!value || typeof value !== 'object') throw new Error('专用分割工作进程响应无效')
  const response = value as Record<string, unknown>
  if (typeof response.id !== 'string' || !response.id) throw new Error('专用分割工作进程响应无效')
  if (response.kind === 'error' && typeof response.error === 'string') {
    return { kind: 'error', id: response.id, error: response.error }
  }
  if (
    response.kind === 'result'
    && typeof response.sessionLoadMs === 'number'
    && response.sessionLoadMs >= 0
    && typeof response.inferenceMs === 'number'
    && response.inferenceMs >= 0
    && typeof response.sessionReused === 'boolean'
  ) {
    return {
      kind: 'result',
      id: response.id,
      sessionLoadMs: response.sessionLoadMs,
      inferenceMs: response.inferenceMs,
      sessionReused: response.sessionReused,
    }
  }
  throw new Error('专用分割工作进程协议不兼容')
}

export class SpecializedWorkerClient {
  private worker: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private readonly pending = new Map<string, PendingRequest>()

  constructor(
    private readonly launch: () => SpecializedWorkerLaunch,
    private readonly timeoutMs = 90_000,
  ) {}

  async segment(command: Record<string, unknown>, signal?: AbortSignal): Promise<SpecializedWorkerResult> {
    signal?.throwIfAborted()
    const worker = this.ensureWorker()
    const id = randomUUID()
    return new Promise<SpecializedWorkerResult>((resolve, reject) => {
      const abortListener = signal
        ? () => this.terminate(errorFromReason(signal.reason, '自动选择已取消'))
        : undefined
      const timer = setTimeout(() => {
        this.terminate(new Error('专用分割工作进程超时'))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer, signal, abortListener })
      signal?.addEventListener('abort', abortListener!, { once: true })
      if (signal?.aborted) {
        abortListener?.()
        return
      }
      try {
        worker.stdin.write(`${JSON.stringify({ id, op: 'segment', ...command })}\n`)
      } catch (error) {
        this.finish(id, undefined, errorFromReason(error, '无法提交专用分割任务'))
      }
    })
  }

  shutdown(): void {
    this.terminate(new Error('专用分割工作进程已关闭'))
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker && !this.worker.killed) return this.worker
    const launch = this.launch()
    const worker = spawn(launch.executable, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.worker = worker
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    worker.stdout.setEncoding('utf8')
    worker.stderr.setEncoding('utf8')
    worker.stdout.on('data', (chunk: string) => {
      if (this.worker === worker) this.consumeStdout(chunk)
    })
    worker.stderr.on('data', (chunk: string) => {
      if (this.worker === worker) this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-8_192)
    })
    worker.stdin.on('error', (error) => {
      if (this.worker === worker) this.terminate(error)
    })
    worker.once('error', (error) => {
      if (this.worker === worker) this.terminate(error)
    })
    worker.once('exit', (code, signal) => {
      if (this.worker !== worker) return
      const detail = this.stderrBuffer.trim()
      this.worker = null
      this.rejectAll(new Error(detail || `专用分割工作进程已退出 (${signal ?? code ?? 'unknown'})`))
    })
    return worker
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) {
        let response: SpecializedWorkerResult | SpecializedWorkerError
        try {
          response = parseResponse(line)
        } catch (error) {
          this.terminate(errorFromReason(error, '专用分割工作进程响应无效'))
          return
        }
        if (response.kind === 'result') this.finish(response.id, response)
        else this.finish(response.id, undefined, new Error(response.error))
      }
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private finish(id: string, result?: SpecializedWorkerResult, error?: Error): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (pending.abortListener) pending.signal?.removeEventListener('abort', pending.abortListener)
    if (error) pending.reject(error)
    else if (result) pending.resolve(result)
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.finish(id, undefined, error)
  }

  private terminate(error: Error): void {
    const worker = this.worker
    this.worker = null
    this.rejectAll(error)
    if (worker && !worker.killed) worker.kill()
  }
}
