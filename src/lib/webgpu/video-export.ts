import type { CompositionInput } from '../../shared/types'
import type {
  WebGpuVideoExportProgressMessage,
  WebGpuVideoExportStartMessage,
  WebGpuVideoExportSourceMessage,
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

function sourceDescriptors(composition: CompositionInput): Array<Pick<WebGpuVideoExportSourceMessage, 'path' | 'key' | 'sourceType'>> {
  const descriptors = new Map<string, Pick<WebGpuVideoExportSourceMessage, 'path' | 'key' | 'sourceType'>>()
  for (const layer of composition.layers) {
    const sourceType = layer.source.sourceType === 'video' ? 'video' : 'image'
    const key = layer.source.key ?? layer.source.path
    const descriptorKey = `${sourceType}\u0000${key}`
    if (!descriptors.has(descriptorKey)) {
      descriptors.set(descriptorKey, { path: layer.source.path, key, sourceType })
    }
  }
  return [...descriptors.values()]
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
  const descriptors = sourceDescriptors(params.composition)
  if (descriptors.length === 0) throw new Error('WebGPU 视频导出缺少媒体源')
  const sources = await Promise.all(descriptors.map(async (descriptor): Promise<WebGpuVideoExportSourceMessage> => {
    const source = await window.luna.workspace.readMediaFile(localMediaPath(descriptor.path))
    return {
      ...descriptor,
      bytes: source.bytes,
      mimeType: source.mimeType,
      fileName: source.name,
    }
  }))
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
        composition: params.composition,
        sources,
        width: params.width,
        height: params.height,
        fps: params.fps,
        qualityPreset: params.qualityPreset,
        includeAudio: params.includeAudio,
      }
      worker.postMessage(start, sources.map((source) => source.bytes))
    })
    return result
  } finally {
    if (cancelTimer !== null) window.clearInterval(cancelTimer)
    worker.terminate()
  }
}
