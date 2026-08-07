import { importMediaLibraryService, useMediaLibraryStore } from '@freecut/features/editor/deps/media-library'

export interface AudioBeatEvidence {
  mediaId: string
  sourceFingerprint: string
  tempoBpm: number
  beats: number[]
  analyzedAt: number
}

interface PendingRequest {
  resolve: (value: Pick<AudioBeatEvidence, 'tempoBpm' | 'beats'>) => void
  reject: (reason?: unknown) => void
}

const cache = new Map<string, AudioBeatEvidence>()
const pending = new Map<string, PendingRequest>()
let worker: Worker | null = null

function fingerprint(media: { contentHash?: string; fileSize: number; fileLastModified?: number; updatedAt: number }): string {
  return media.contentHash ?? `${media.fileSize}:${media.fileLastModified ?? media.updatedAt}`
}

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./audio-beat-worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: string; tempo: number; beats: number[] }>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    request.resolve({ tempoBpm: event.data.tempo, beats: event.data.beats })
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || '无法分析音乐节拍。')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const legacyWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext }
  const AudioContextClass = window.AudioContext ?? legacyWindow.webkitAudioContext
  if (!AudioContextClass) throw new Error('当前设备无法读取音频内容。')
  const context = new AudioContextClass()
  return blob.arrayBuffer()
    .then((buffer) => context.decodeAudioData(buffer))
    .finally(() => void context.close())
}

function analyzeSamples(samples: Float32Array): Promise<Pick<AudioBeatEvidence, 'tempoBpm' | 'beats'>> {
  const id = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, samples: samples.buffer }, [samples.buffer])
  })
}

export function getAudioBeatEvidence(mediaId: string): AudioBeatEvidence | undefined {
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) return undefined
  const value = cache.get(mediaId)
  return value?.sourceFingerprint === fingerprint(media) ? value : undefined
}

export async function analyzeAudioBeats(mediaId: string): Promise<AudioBeatEvidence> {
  const media = useMediaLibraryStore.getState().mediaById[mediaId]
  if (!media) throw new Error('没有找到这段素材。')
  if (!media.mimeType.startsWith('audio/') && !media.mimeType.startsWith('video/')) {
    throw new Error('只能分析带声音的素材。')
  }

  const sourceFingerprint = fingerprint(media)
  const cached = cache.get(mediaId)
  if (cached?.sourceFingerprint === sourceFingerprint) return cached

  const { mediaLibraryService } = await importMediaLibraryService()
  const file = await mediaLibraryService.getMediaFile(mediaId)
  if (!file) throw new Error('无法读取这段素材的声音。')
  const decoded = await decodeAudio(file)
  const samples = decoded.getChannelData(0).slice()
  const result = await analyzeSamples(samples)
  if (result.beats.length < 2 || result.tempoBpm <= 0) {
    throw new Error('没有识别到稳定的音乐节拍。')
  }

  const evidence: AudioBeatEvidence = {
    mediaId,
    sourceFingerprint,
    tempoBpm: result.tempoBpm,
    beats: result.beats,
    analyzedAt: Date.now(),
  }
  cache.set(mediaId, evidence)
  return evidence
}

export function disposeAudioBeatAnalyzer(): void {
  worker?.terminate()
  worker = null
  pending.clear()
}
