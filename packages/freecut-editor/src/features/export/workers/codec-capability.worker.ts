import type { ClientCodec } from '../utils/client-renderer'

// Electron exposes WebCodecs encoders in dedicated workers but not on the
// window global. Mediabunny only needs the worker globals for this probe.
type WorkerGlobalWithWindow = typeof globalThis & { window?: unknown }
const workerGlobal = globalThis as WorkerGlobalWithWindow
if (typeof workerGlobal.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  })
}

interface CodecCapabilityRequest {
  width: number
  height: number
  bitrate?: number
  codecs: ClientCodec[]
}

self.onmessage = async (event: MessageEvent<CodecCapabilityRequest>) => {
  try {
    const { canEncodeVideo } = await import('mediabunny')
    const supported: ClientCodec[] = []

    for (const codec of event.data.codecs) {
      if (await canEncodeVideo(codec, {
        width: event.data.width,
        height: event.data.height,
        bitrate: event.data.bitrate,
      })) {
        supported.push(codec)
      }
    }

    self.postMessage({ supported })
  } catch (error) {
    self.postMessage({
      supported: [],
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export {}
