import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import type { TimedSubtitleUnit } from '../src/shared/subtitleSegmentation'

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

interface PunctuationResponse {
  punctuations: string[]
  modelLoadMs: number
  inferenceMs: number
}

function appRoot(): string {
  return process.env.APP_ROOT ?? path.join(import.meta.dirname, '..')
}

function workerPath(): string {
  const name = process.platform === 'win32' ? 'luna-punctuation-worker.exe' : 'luna-punctuation-worker'
  return app.isPackaged
    ? path.join(process.resourcesPath, 'luna-render-core', name)
    : path.join(appRoot(), 'luna-render-core', name)
}

function terminate(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 1_500)
  timer.unref()
}

function parseResponse(raw: string, expectedCount: number): PunctuationResponse {
  const value = JSON.parse(raw) as Partial<PunctuationResponse>
  if (!Array.isArray(value.punctuations) || value.punctuations.length !== expectedCount) {
    throw new Error('标点分析返回了不完整的数据')
  }
  if (!value.punctuations.every((item) => typeof item === 'string' && item.length <= 2)) {
    throw new Error('标点分析返回了无效数据')
  }
  if (!Number.isFinite(value.modelLoadMs) || !Number.isFinite(value.inferenceMs)) {
    throw new Error('标点分析返回了无效耗时')
  }
  return value as PunctuationResponse
}

export async function restoreSubtitlePunctuation(
  units: TimedSubtitleUnit[],
  modelPath: string,
  signal: AbortSignal,
): Promise<PunctuationResponse> {
  signal.throwIfAborted()
  if (units.length === 0) return { punctuations: [], modelLoadMs: 0, inferenceMs: 0 }
  const worker = spawn(workerPath(), [modelPath], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const abort = (): void => terminate(worker)
  signal.addEventListener('abort', abort, { once: true })
  worker.stdout.setEncoding('utf8')
  worker.stderr.setEncoding('utf8')
  worker.stdin.on('error', () => undefined)
  worker.stdout.on('data', (chunk: string) => {
    stdout += chunk
    if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) terminate(worker)
  })
  worker.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-16_384) })
  worker.stdin.end(JSON.stringify({ units: units.map((unit) => unit.text) }))
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('close', resolve)
    })
    signal.throwIfAborted()
    if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) throw new Error('标点分析返回的数据过大')
    if (exitCode !== 0) throw new Error(stderr.trim() || '标点分析未完成')
    return parseResponse(stdout, units.length)
  } finally {
    signal.removeEventListener('abort', abort)
    if (worker.exitCode === null) terminate(worker)
  }
}
