import { Worker } from 'node:worker_threads'

import type { WorkspaceMaskTrackingRequest, WorkspaceMaskTrackingResult } from '../src/shared/types/api'

interface TrackingWorkerMessage {
  requestId: string
  kind: 'progress' | 'result' | 'error'
  percent?: number
  time?: number
  confidence?: number
  keyframes?: WorkspaceMaskTrackingResult['keyframes']
  stoppedReason?: string
  completed?: boolean
  error?: string
}

export function trackMaskInWorker(
  request: WorkspaceMaskTrackingRequest & { duration: number; sourceWidth: number; sourceHeight: number },
  ffmpegPath: string,
  signal: AbortSignal,
  onProgress: (progress: { percent: number; time: number; confidence: number }) => void,
): Promise<WorkspaceMaskTrackingResult> {
  signal.throwIfAborted()
  const worker = new Worker(new URL('./maskTrackingWorker.ts', import.meta.url), { workerData: null })
  worker.postMessage({ ...request, ffmpegPath })
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, result?: WorkspaceMaskTrackingResult): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      void worker.terminate()
      if (error) reject(error)
      else if (result) resolve(result)
    }
    const abort = (): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      worker.postMessage({ kind: 'cancel' })
      setTimeout(() => { void worker.terminate() }, 250)
      reject(signal.reason instanceof Error ? signal.reason : new Error('蒙版追踪已取消'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.on('message', (message: TrackingWorkerMessage) => {
      if (message.requestId !== request.requestId) return
      if (message.kind === 'progress' && message.percent !== undefined && message.time !== undefined && message.confidence !== undefined) {
        onProgress({ percent: message.percent, time: message.time, confidence: message.confidence })
      } else if (message.kind === 'error') {
        finish(new Error(message.error || '蒙版追踪失败'))
      } else if (message.kind === 'result' && message.keyframes) {
        finish(undefined, {
          requestId: request.requestId,
          direction: request.direction,
          anchorTime: request.anchorTime,
          keyframes: message.keyframes,
          completed: Boolean(message.completed),
          stoppedReason: message.stoppedReason,
        })
      }
    })
    worker.once('error', (error) => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once('exit', (code) => {
      if (!settled && code !== 0) finish(new Error(`蒙版追踪线程异常退出 (${code})`))
    })
  })
}
