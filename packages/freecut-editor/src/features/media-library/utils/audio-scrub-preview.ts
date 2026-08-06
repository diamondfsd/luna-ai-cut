interface AudioScrubPreviewRequest {
  mediaId: string
  mediaUrl: string
  timeSeconds: number
  gain?: number
}

interface ActiveGrain {
  source: AudioBufferSourceNode
  gainNode: GainNode
}

interface AudioScrubPreviewOptions {
  createAudioContext?: () => AudioContext
  fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>
  grainDurationSeconds?: number
  fadeSeconds?: number
  gain?: number
}

const DEFAULT_GRAIN_DURATION_SECONDS = 0.08
const DEFAULT_FADE_SECONDS = 0.008
const DEFAULT_GAIN = 0.8

export function getAudioScrubTime(durationSeconds: number, progress: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0
  }

  const clampedProgress = Math.max(0, Math.min(1, progress))
  return durationSeconds * clampedProgress
}

function getDefaultAudioContext(): AudioContext {
  return new AudioContext()
}

async function defaultFetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  return response.arrayBuffer()
}

export function createAudioScrubPreview(options: AudioScrubPreviewOptions = {}) {
  const createAudioContext = options.createAudioContext ?? getDefaultAudioContext
  const fetchArrayBuffer = options.fetchArrayBuffer ?? defaultFetchArrayBuffer
  const grainDurationSeconds = options.grainDurationSeconds ?? DEFAULT_GRAIN_DURATION_SECONDS
  const fadeSeconds = options.fadeSeconds ?? DEFAULT_FADE_SECONDS
  const gainValue = options.gain ?? DEFAULT_GAIN

  let context: AudioContext | null = null
  let activeGrain: ActiveGrain | null = null
  const buffers = new Map<string, Promise<AudioBuffer>>()

  const getContext = () => {
    if (!context) {
      context = createAudioContext()
    }
    return context
  }

  const loadBuffer = (mediaId: string, mediaUrl: string) => {
    const existing = buffers.get(mediaId)
    if (existing) return existing

    const bufferPromise = (async () => {
      const ctx = getContext()
      const arrayBuffer = await fetchArrayBuffer(mediaUrl)
      return ctx.decodeAudioData(arrayBuffer.slice(0))
    })()

    buffers.set(mediaId, bufferPromise)
    return bufferPromise
  }

  const stop = () => {
    const grain = activeGrain
    activeGrain = null
    if (!grain) return

    try {
      grain.source.stop()
    } catch {
      // Source may have already stopped; cleanup is best-effort.
    }
    try {
      grain.source.disconnect()
    } catch {
      // Best-effort cleanup.
    }
    try {
      grain.gainNode.disconnect()
    } catch {
      // Best-effort cleanup.
    }
  }

  const scrub = async ({ mediaId, mediaUrl, timeSeconds, gain = 1 }: AudioScrubPreviewRequest) => {
    if (!mediaUrl) return

    const ctx = getContext()
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }

    const buffer = await loadBuffer(mediaId, mediaUrl)
    stop()

    const duration = Math.max(0, buffer.duration)
    const grainDuration = Math.min(grainDurationSeconds, Math.max(0, duration))
    if (grainDuration <= 0) return

    const offset = Math.max(0, Math.min(timeSeconds, Math.max(0, duration - grainDuration)))
    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    const gainNode = ctx.createGain()

    source.buffer = buffer
    source.connect(gainNode)
    gainNode.connect(ctx.destination)

    gainNode.gain.cancelScheduledValues(now)
    gainNode.gain.setValueAtTime(0, now)
    gainNode.gain.linearRampToValueAtTime(gainValue * gain, now + fadeSeconds)
    gainNode.gain.linearRampToValueAtTime(0, now + grainDuration)

    source.onended = () => {
      if (activeGrain?.source === source) {
        activeGrain = null
      }
      try {
        source.disconnect()
      } catch {
        // Best-effort cleanup.
      }
      try {
        gainNode.disconnect()
      } catch {
        // Best-effort cleanup.
      }
    }

    activeGrain = { source, gainNode }
    source.start(now, offset, grainDuration)
  }

  const dispose = () => {
    stop()
    buffers.clear()
    if (context) {
      void context.close().catch(() => {})
      context = null
    }
  }

  return { scrub, stop, dispose }
}

export const audioScrubPreview = createAudioScrubPreview()
