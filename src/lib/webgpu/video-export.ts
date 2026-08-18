import type { CompositionInput } from '../../shared/types'
import type {
  WebGpuVideoExportProgressMessage,
  WebGpuVideoExportStartMessage,
  WebGpuVideoExportWorkerResponse,
} from './video-export-protocol'

export interface WebGpuVideoExportResult {
  blob: Blob
  duration: number
  frameCount: number
  audioCopied: boolean
}

function localMediaPath(filePath: string): string {
  if (!filePath.startsWith('file://')) return filePath
  try {
    return decodeURIComponent(new URL(filePath).pathname)
  } catch {
    return filePath.slice(7)
  }
}

function isCanceledTask(itemId: string, task: Awaited<ReturnType<typeof window.luna.exportTask.get>>): boolean {
  return task?.status === 'canceled' || task?.items.find((item) => item.id === itemId)?.status === 'canceled'
}

export async function exportVideoWithWebGpuWorker(params: {
  sourcePath: string
  composition: CompositionInput
  width: number
  height: number
  fps: number | null
  qualityPreset: string
  includeAudio: boolean
  exportTaskId?: string
  exportItemId?: string
  onProgress?: (progress: WebGpuVideoExportProgressMessage) => void | Promise<void>
}): Promise<WebGpuVideoExportResult> {
  const source = await window.luna.workspace.readMediaFile(localMediaPath(params.sourcePath))
  const worker = new Worker(new URL('./video-export.worker.ts', import.meta.url), { type: 'module' })
  let cancelTimer: number | null = null
  let cancelRequested = false

  try {
    const result = await new Promise<WebGpuVideoExportResult>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WebGpuVideoExportWorkerResponse>) => {
        const message = event.data
        if (message.type === 'progress') {
          void params.onProgress?.(message)
          return
        }
        if (message.type === 'error') {
          reject(Object.assign(new Error(message.message), { name: message.canceled ? 'AbortError' : 'Error' }))
          return
        }
        resolve({
          blob: new Blob([message.buffer], { type: 'video/mp4' }),
          duration: message.duration,
          frameCount: message.frameCount,
          audioCopied: message.audioCopied,
        })
      }
      const onError = (event: ErrorEvent) => {
        reject(new Error(event.message || 'WebGPU 视频导出 Worker 异常'))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)

      if (params.exportTaskId && params.exportItemId) {
        cancelTimer = window.setInterval(() => {
          void window.luna.exportTask.get(params.exportTaskId!).then((task) => {
            if (cancelRequested || !isCanceledTask(params.exportItemId!, task)) return
            cancelRequested = true
            worker.postMessage({ type: 'cancel' })
          }).catch(() => {})
        }, 250)
      }

      const start: WebGpuVideoExportStartMessage = {
        type: 'start',
        bytes: source.bytes,
        mimeType: source.mimeType,
        fileName: source.name,
        composition: params.composition,
        width: params.width,
        height: params.height,
        fps: params.fps,
        qualityPreset: params.qualityPreset,
        includeAudio: params.includeAudio,
      }
      worker.postMessage(start, [source.bytes])
    })
    return result
  } finally {
    if (cancelTimer !== null) window.clearInterval(cancelTimer)
    worker.terminate()
  }
}
