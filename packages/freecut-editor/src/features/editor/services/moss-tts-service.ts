import { createLogger } from '@freecut/shared/logging/logger'
import { sanitizeAiOutputFileNameSegment } from '@freecut/shared/utils/ai-output-filename'
import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@freecut/shared/state/local-inference'
import { validateTtsGenerateRequest } from './tts-generate-validation'

const logger = createLogger('MossTtsService')
const MODEL_KEY = 'nano-zh'
const MODEL_LABEL = 'Multilingual Nano'
const ESTIMATED_BYTES = 763_158_119

interface MossTtsProgress {
  requestId: string
  stage: string
  fraction: number | null
  loadedBytes?: number
  totalBytes?: number
}

interface MossTtsApi {
  getStatus(): Promise<{
    supported: boolean
    environment: 'missing-python' | 'missing-model' | 'ready'
    cacheRoot: string
    modelCached: boolean
    estimatedBytes: number
  }>
  generate(request: {
    requestId: string
    text: string
    voice: MossTtsVoice
    speed: number
    referenceAudioPath?: string
  }): Promise<{ requestId: string; fileName: string; durationSeconds: number; bytes: Uint8Array }>
  cancel(requestId: string): Promise<void>
  unload(): Promise<void>
  onProgress(callback: (progress: MossTtsProgress) => void): () => void
}

interface GenerateSpeechOptions {
  text: string
  voice: MossTtsVoice
  speed: number
  referenceAudioPath?: string
  onProgress?: (stage: string, fraction?: number, phase?: MossGenerationPhase) => void
  signal?: AbortSignal
}

type MossGenerationPhase = 'preparing-model' | 'generating'

export const MOSS_TTS_VOICE_OPTIONS = [
  { value: 'Junhao', label: 'Junhao (ZH, M)' },
  { value: 'Zhiming', label: 'Zhiming (ZH, M)' },
  { value: 'Weiguo', label: 'Weiguo (ZH, M)' },
  { value: 'Xiaoyu', label: 'Xiaoyu (ZH, F)' },
  { value: 'Yuewen', label: 'Yuewen (ZH, F)' },
  { value: 'Lingyu', label: 'Lingyu (ZH, F)' },
  { value: 'Trump', label: 'Trump (EN, M)' },
  { value: 'Ava', label: 'Ava (EN, F)' },
  { value: 'Bella', label: 'Bella (EN, F)' },
  { value: 'Adam', label: 'Adam (EN, M)' },
  { value: 'Nathan', label: 'Nathan (EN, M)' },
  { value: 'Soyo', label: 'Soyo (JA, F)' },
  { value: 'Saki', label: 'Saki (JA, F)' },
  { value: 'Mortis', label: 'Mortis (JA, F)' },
  { value: 'Umiri', label: 'Umiri (JA, F)' },
  { value: 'Mei', label: 'Mei (JA, F)' },
  { value: 'Anon', label: 'Anon (JA, F)' },
  { value: 'Arisa', label: 'Arisa (JA, F)' },
] as const

export type MossTtsVoice = (typeof MOSS_TTS_VOICE_OPTIONS)[number]['value']

export const MOSS_TTS_SUPPORTED_LANGUAGES = [
  'Chinese',
  'English',
  'Japanese',
  'Korean',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Hungarian',
  'Russian',
  'Persian',
  'Arabic',
  'Polish',
  'Portuguese',
  'Czech',
  'Danish',
  'Swedish',
  'Greek',
  'Turkish',
] as const

function createOutputFileName(text: string, voice: MossTtsVoice): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `ai-tts-${sanitizeAiOutputFileNameSegment(text, 'speech')}-${sanitizeAiOutputFileNameSegment(voice, 'speech')}-moss-${timestamp}.wav`
}

function getApi(): MossTtsApi | null {
  const host = (globalThis as typeof globalThis & { luna?: { mossTts?: MossTtsApi } }).luna
  return host?.mossTts ?? null
}

function createAbortError(): DOMException {
  return new DOMException('Audio generation cancelled.', 'AbortError')
}

export function getMossTtsVoiceOption(voice: MossTtsVoice): { value: MossTtsVoice; label: string } {
  return (
    MOSS_TTS_VOICE_OPTIONS.find((option) => option.value === voice) ?? {
      value: voice,
      label: voice,
    }
  )
}

class MossTtsService {
  private activeJobs = 0
  private generationChain: Promise<void> = Promise.resolve()

  isSupported(): boolean {
    return getApi() !== null
  }

  private getRuntimeId(): string {
    return 'moss-tts:nano'
  }

  private updateRuntime(
    state: 'loading' | 'running' | 'ready' | 'error',
    updates: { loadingPhase?: 'downloading' | 'preparing'; loadedBytes?: number } = {},
    errorMessage?: string,
  ): void {
    const runtimeId = this.getRuntimeId()
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId]
    const now = Date.now()
    const runtime = {
      feature: 'tts',
      featureLabel: 'MOSS TTS',
      modelKey: MODEL_KEY,
      modelLabel: MODEL_LABEL,
      backend: 'cpu' as const,
      state,
      estimatedBytes: ESTIMATED_BYTES,
      activeJobs: this.activeJobs,
      loadedAt: existing?.loadedAt ?? now,
      lastUsedAt: now,
      unloadable: true,
      errorMessage,
      ...updates,
    }
    if (existing) {
      localInferenceRuntimeRegistry.updateRuntime(runtimeId, runtime)
    } else {
      localInferenceRuntimeRegistry.registerRuntime(
        { id: runtimeId, ...runtime },
        { unload: () => this.unload() },
      )
    }
  }

  private incrementJobs(): void {
    this.activeJobs += 1
    this.updateRuntime('running')
  }

  private decrementJobs(): void {
    this.activeJobs = Math.max(0, this.activeJobs - 1)
    this.updateRuntime('ready')
  }

  private async withGenerationLock<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.generationChain
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.generationChain = previous.then(() => current)
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }

  async unload(): Promise<void> {
    await getApi()?.unload()
    this.activeJobs = 0
    localInferenceRuntimeRegistry.unregisterRuntime(this.getRuntimeId())
  }

  async generateSpeechFile({
    text,
    voice,
    speed,
    referenceAudioPath,
    onProgress,
    signal,
  }: GenerateSpeechOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedText = validateTtsGenerateRequest({
      text,
      isSupported: this.isSupported(),
      unsupportedMessage: '当前应用无法启动本地 MOSS 语音环境。',
    })
    const api = getApi()
    if (!api) throw new Error('当前应用无法启动本地 MOSS 语音环境。')
    if (signal?.aborted) throw createAbortError()

    return this.withGenerationLock(async () => {
      const requestId = crypto.randomUUID()
      let cancelled = false
      const cancel = () => {
        cancelled = true
        void api.cancel(requestId)
      }
      const unsubscribe = api.onProgress((progress) => {
        if (progress.requestId !== requestId) return
        const isGenerating = progress.stage === 'generating' || progress.stage === 'saving'
        this.updateRuntime(
          isGenerating ? 'running' : 'loading',
          progress.stage === 'downloading-model'
            ? { loadingPhase: 'downloading', loadedBytes: progress.loadedBytes }
            : { loadingPhase: 'preparing', loadedBytes: progress.loadedBytes },
        )
        onProgress?.(
          progress.stage,
          progress.fraction ?? undefined,
          isGenerating ? 'generating' : 'preparing-model',
        )
      })
      signal?.addEventListener('abort', cancel, { once: true })
      this.updateRuntime('loading', { loadingPhase: 'preparing' })
      this.incrementJobs()
      try {
        if (signal?.aborted) throw createAbortError()
        const result = await api.generate({
          requestId,
          text: trimmedText,
          voice,
          speed,
          ...(referenceAudioPath ? { referenceAudioPath } : {}),
        })
        if (cancelled || signal?.aborted) throw createAbortError()
        const bytes = new Uint8Array(result.bytes)
        const blob = new Blob([bytes], { type: 'audio/wav' })
        const file = new File([blob], createOutputFileName(trimmedText, voice), {
          type: 'audio/wav',
          lastModified: Date.now(),
        })
        return { blob, file, duration: result.durationSeconds }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Failed to generate speech with MOSS TTS runtime', error)
        this.updateRuntime('error', {}, message)
        throw error
      } finally {
        unsubscribe()
        signal?.removeEventListener('abort', cancel)
        this.decrementJobs()
      }
    })
  }
}

export const mossTtsService = new MossTtsService()
