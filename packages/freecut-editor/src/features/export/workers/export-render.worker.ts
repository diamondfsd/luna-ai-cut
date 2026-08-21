import { isGifUrl, isWebpUrl } from '@freecut/shared/utils/media-utils'
import { createLogger } from '@freecut/shared/logging/logger'
import { registerObjectUrl, unregisterObjectUrl } from '@freecut/infrastructure/browser/object-url-registry'
import type { ImageItem } from '@freecut/types/timeline'
import type { RenderProgress } from '../utils/client-renderer'
import type {
  ExportRenderWorkerRequest,
  ExportRenderWorkerResponse,
} from './export-render-worker.types'

// Some third-party browser libs assume `window` exists.
// In dedicated workers, alias it to `globalThis` to avoid runtime crashes.
type WorkerGlobalWithWindow = typeof globalThis & { window?: unknown }
const workerGlobal = globalThis as WorkerGlobalWithWindow
if (typeof workerGlobal.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
}

const log = createLogger('ExportRenderWorker')

// Capture floating rejections / uncaught errors with their stack. Bare
// mediabunny asserts surface only "Assertion failed"; without the stack the
// failing call site is invisible, so log it explicitly here.
self.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  log.error('Export worker unhandled rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  })
})
self.addEventListener('error', (event) => {
  log.error('Export worker uncaught error', {
    error: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    filename: event.filename,
    lineno: event.lineno,
  })
})

const activeRequests = new Map<string, AbortController>()

// Keep the heavy render graph behind a dynamic import. Static ESM imports are
// evaluated before this worker's body, which meant browser-only dependencies
// (including React Refresh during development) ran before the `window` shim.
const loadRenderers = () => import('../utils/canvas-render-orchestrator')

function compositionHasAnimatedImage(
  tracks: Array<{ items: Array<{ type: string; src?: string; label?: string }> }>,
): boolean {
  for (const track of tracks) {
    for (const item of track.items ?? []) {
      if (item.type !== 'image') continue
      const imageItem = item as ImageItem
      const label = (imageItem.label ?? '').toLowerCase()
      if (
        isGifUrl(imageItem.src) ||
        label.endsWith('.gif') ||
        isWebpUrl(imageItem.src) ||
        label.endsWith('.webp')
      ) {
        return true
      }
    }
  }
  return false
}

self.onmessage = async (event: MessageEvent<ExportRenderWorkerRequest>) => {
  const message = event.data

  if (message.type === 'cancel') {
    const controller = activeRequests.get(message.requestId)
    if (controller) {
      controller.abort()
    }
    return
  }

  if (message.type !== 'start') {
    return
  }

  const { requestId, settings, composition } = message
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  const registeredSourceUrls = new Set<string>()

  try {
    for (const source of message.sources ?? []) {
      registerObjectUrl(source.url, source.blob)
      registeredSourceUrls.add(source.url)
    }

    if (settings.mode === 'video' && compositionHasAnimatedImage(composition.tracks ?? [])) {
      throw new Error('WORKER_REQUIRES_MAIN_THREAD:animated-image')
    }
    const { renderAudioOnly, renderComposition } = await loadRenderers()

    const onProgress = (progress: RenderProgress) => {
      const response: ExportRenderWorkerResponse = {
        type: 'progress',
        requestId,
        progress,
      }
      self.postMessage(response)
    }

    const result =
      settings.mode === 'audio'
        ? await renderAudioOnly({
            settings,
            composition,
            onProgress,
            signal: controller.signal,
          })
        : await renderComposition({
            settings,
            composition,
            onProgress,
            signal: controller.signal,
          })

    const complete: ExportRenderWorkerResponse = {
      type: 'complete',
      requestId,
      result,
    }
    self.postMessage(complete)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const cancelled: ExportRenderWorkerResponse = {
        type: 'cancelled',
        requestId,
      }
      self.postMessage(cancelled)
      return
    }

    const messageText = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    // Surface the stack: bare mediabunny asserts report only "Assertion failed",
    // so without the stack the failing call site is invisible on the main thread.
    const isWorkerEnvironmentDependency =
      error instanceof ReferenceError &&
      /\b(document|navigator|HTML\w*Element|OfflineAudioContext|AudioContext)\b/.test(messageText)
    const logMessage = `Export worker ${isWorkerEnvironmentDependency ? 'requires main thread' : 'failed'} (${requestId}): ${messageText}${stack ? `\n${stack}` : ''}`
    if (isWorkerEnvironmentDependency) {
      log.warn(logMessage)
    } else {
      log.error(logMessage)
    }
    // A DOM global reaching worker code is a bug in that code, not something the
    // user can act on — and it used to fail the whole export. Report it as a
    // main-thread fallback instead: the render still completes, and the reason
    // (with the original message) lands in the export's wide event so the
    // offending call site stays visible rather than being silently absorbed.
    const failure: ExportRenderWorkerResponse = {
      type: 'error',
      requestId,
      error: isWorkerEnvironmentDependency
        ? `WORKER_REQUIRES_MAIN_THREAD:dom-dependency:${messageText}`
        : messageText,
    }
    self.postMessage(failure)
  } finally {
    for (const url of registeredSourceUrls) unregisterObjectUrl(url)
    activeRequests.delete(requestId)
  }
}

export {}
