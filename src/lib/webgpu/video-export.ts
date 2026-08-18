import type { CompositionInput } from '../../shared/types'
import type {
  WebGpuVideoExportLutMessage,
  WebGpuVideoExportMaskMessage,
  WebGpuVideoExportFontMessage,
  WebGpuVideoExportProgressMessage,
  WebGpuVideoExportStartMessage,
  WebGpuVideoExportSourceMessage,
  WebGpuVideoExportWorkerResponse,
} from './video-export-protocol'
import { readWebGpuLut } from './lut-source'

export interface WebGpuVideoExportResult {
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
    const layerType = layer.layerType ?? 'media'
    const hasExternalSource = layerType === 'media'
      || layerType === 'local-color'
      || ((layerType === 'logo' || layerType === 'decoration') && Boolean(layer.source.path))
    if (!hasExternalSource) continue
    const sourceType = layer.source.sourceType === 'video' ? 'video' : 'image'
    const key = layer.source.key ?? layer.source.path
    const descriptorKey = `${sourceType}\u0000${key}`
    if (!descriptors.has(descriptorKey)) {
      descriptors.set(descriptorKey, { path: layer.source.path, key, sourceType })
    }
  }
  return [...descriptors.values()]
}

function lutPaths(composition: CompositionInput): string[] {
  return [...new Set(composition.layers.flatMap((layer) => [
    layer.lutId,
    layer.restoreLutId,
  ].filter((path): path is string => Boolean(path))))]
}

function maskDescriptors(composition: CompositionInput): Array<{ projectId: string; path: string }> {
  const descriptors = new Map<string, { projectId: string; path: string }>()
  for (const layer of composition.layers) {
    const projectId = layer.maskProjectId
    if (!projectId) continue
    const paths = [
      layer.maskPath,
      ...(layer.maskTimeline?.frames.map((frame) => frame.path) ?? []),
    ]
    for (const path of paths) {
      if (!path) continue
      descriptors.set(`${projectId}\u0000${path}`, { projectId, path })
    }
  }
  return [...descriptors.values()]
}

function fontPaths(composition: CompositionInput): string[] {
  return [...new Set(composition.layers.flatMap((layer) => (
    layer.fontFile && (layer.layerType === 'text' || layer.layerType === 'logo' || layer.layerType === 'decoration')
      ? [layer.fontFile]
      : []
  )))]
}

async function fontSources(composition: CompositionInput): Promise<WebGpuVideoExportFontMessage[]> {
  const sources = await Promise.all(fontPaths(composition).map(async (fontPath): Promise<WebGpuVideoExportFontMessage | null> => {
    try {
      if (fontPath.startsWith('fonts/')) {
        const response = await fetch(fontPath)
        if (!response.ok) return null
        return {
          path: fontPath,
          mimeType: response.headers.get('content-type') || (fontPath.endsWith('.otf') ? 'font/otf' : 'font/ttf'),
          bytes: await response.arrayBuffer(),
        }
      }
      const source = await window.luna.workspace.readSubtitleFontFile(fontPath)
      return { path: fontPath, mimeType: source.mimeType, bytes: source.bytes }
    } catch {
      return null
    }
  }))
  return sources.filter((source): source is WebGpuVideoExportFontMessage => source !== null)
}

function isCanceledTask(itemId: string, task: Awaited<ReturnType<typeof window.luna.exportTask.get>>): boolean {
  return task?.status === 'canceled' || task?.items.find((item) => item.id === itemId)?.status === 'canceled'
}

export async function exportVideoWithWebGpuWorker(params: {
  composition: CompositionInput
  width: number
  height: number
  fps: number | null
  qualityPreset: string
  includeAudio: boolean
  exportTaskId?: string
  exportItemId?: string
  shouldCancel?: () => Promise<boolean>
  onChunk: (chunk: ArrayBuffer) => void | Promise<void>
  onProgress?: (progress: WebGpuVideoExportProgressMessage) => void | Promise<void>
}): Promise<WebGpuVideoExportResult> {
  const descriptors = sourceDescriptors(params.composition)
  const sources = await Promise.all(descriptors.map(async (descriptor): Promise<WebGpuVideoExportSourceMessage> => {
    const source = await window.luna.workspace.readMediaFile(localMediaPath(descriptor.path))
    return {
      ...descriptor,
      bytes: source.bytes,
      mimeType: source.mimeType,
      fileName: source.name,
    }
  }))
  const [luts, masks, fonts] = await Promise.all([
    Promise.all(lutPaths(params.composition).map(async (path): Promise<WebGpuVideoExportLutMessage> => ({
      path,
      text: await readWebGpuLut(path),
    }))),
    Promise.all(maskDescriptors(params.composition).map(async (descriptor): Promise<WebGpuVideoExportMaskMessage> => {
      const source = await window.luna.workspace.loadColorMask(descriptor.projectId, descriptor.path)
      const bytes = Uint8Array.from(new Uint8Array(source.bytes)).buffer
      return {
        ...descriptor,
        width: source.width,
        height: source.height,
        bytes,
      }
    })),
    fontSources(params.composition),
  ])
  const worker = new Worker(new URL('./video-export.worker.ts', import.meta.url), { type: 'module' })
  let cancelTimer: number | null = null
  let cancelRequested = false

  try {
    const result = await new Promise<WebGpuVideoExportResult>((resolve, reject) => {
      let settled = false
      const onMessage = (event: MessageEvent<WebGpuVideoExportWorkerResponse>) => {
        const message = event.data
        if (message.type === 'progress') {
          void params.onProgress?.(message)
          return
        }
        if (message.type === 'chunk') {
          void Promise.resolve(params.onChunk(message.data))
            .then(() => {
              worker.postMessage({ type: 'chunk-ack', id: message.id })
            })
            .catch((error: unknown) => {
              const errorMessage = error instanceof Error ? error.message : String(error)
              worker.postMessage({ type: 'chunk-ack', id: message.id, error: errorMessage })
              if (!settled) {
                settled = true
                reject(error)
                worker.postMessage({ type: 'cancel' })
              }
            })
          return
        }
        if (message.type === 'error') {
          if (settled) return
          settled = true
          reject(Object.assign(new Error(message.message), { name: message.canceled ? 'AbortError' : 'Error' }))
          return
        }
        if (settled) return
        settled = true
        resolve({
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

      if ((params.exportTaskId && params.exportItemId) || params.shouldCancel) {
        cancelTimer = window.setInterval(() => {
          if (cancelRequested) return
          void (async () => {
            const canceled = params.shouldCancel
              ? await params.shouldCancel()
              : isCanceledTask(
                  params.exportItemId!,
                  await window.luna.exportTask.get(params.exportTaskId!),
                )
            if (cancelRequested || !canceled) return
            cancelRequested = true
            worker.postMessage({ type: 'cancel' })
          })().catch(() => {})
        }, 250)
      }

      const start: WebGpuVideoExportStartMessage = {
        type: 'start',
        composition: params.composition,
        sources,
        luts,
        masks,
        fonts,
        width: params.width,
        height: params.height,
        fps: params.fps,
        qualityPreset: params.qualityPreset,
        includeAudio: params.includeAudio,
      }
      worker.postMessage(start, [
        ...sources.map((source) => source.bytes),
        ...masks.map((mask) => mask.bytes),
        ...fonts.map((font) => font.bytes),
      ])
    })
    return result
  } finally {
    if (cancelTimer !== null) window.clearInterval(cancelTimer)
    worker.terminate()
  }
}
