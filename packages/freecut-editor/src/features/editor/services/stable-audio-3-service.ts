import {
  localInferenceRuntimeRegistry,
  useLocalInferenceStore,
} from '@freecut/shared/state/local-inference'
import { createLogger } from '@freecut/shared/logging/logger'
import { sanitizeAiOutputFileNameSegment } from '@freecut/shared/utils/ai-output-filename'
import {
  DEFAULT_STABLE_AUDIO_MODEL,
  getStableAudioModelDefinition,
  STABLE_AUDIO_MODEL_OPTIONS,
  type StableAudioModelId,
} from '@freecut/shared/utils/stable-audio-models'

const logger = createLogger('StableAudio3Service')

interface StableAudio3Progress {
  requestId: string
  model: StableAudioModelId
  stage: string
  fraction: number | null
  loadedBytes?: number
}

interface StableAudio3Api {
  generate(request: {
    requestId: string
    model: StableAudioModelId
    prompt: string
    durationSeconds: number
    guidanceScale?: number
  }): Promise<{ durationSeconds: number; bytes: Uint8Array }>
  cancel(requestId: string): Promise<void>
  unload(): Promise<void>
  onProgress(callback: (progress: StableAudio3Progress) => void): () => void
}

type StableAudioGenerationPhase = 'preparing-model' | 'generating'

interface GenerateMusicOptions {
  prompt: string
  model?: StableAudioModelId
  durationSeconds: number
  guidanceScale?: number
  onProgress?: (stage: string, fraction?: number, phase?: StableAudioGenerationPhase) => void
  signal?: AbortSignal
}

function createOutputFileName(prompt: string, model: StableAudioModelId): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `ai-audio-${sanitizeAiOutputFileNameSegment(prompt, 'audio')}-${model}-${timestamp}.wav`
}

function getApi(): StableAudio3Api | null {
  const host = (globalThis as typeof globalThis & { luna?: { stableAudio3?: StableAudio3Api } }).luna
  return host?.stableAudio3 ?? null
}

function createAbortError(): DOMException {
  return new DOMException('Audio generation cancelled.', 'AbortError')
}

class StableAudio3Service {
  private activeJobs = new Map<StableAudioModelId, number>()
  private generationChain: Promise<void> = Promise.resolve()

  isSupported(): boolean {
    return getApi() !== null
  }

  private runtimeId(model: StableAudioModelId): string {
    return `stable-audio-3:${model}`
  }

  private updateRuntime(
    model: StableAudioModelId,
    state: 'loading' | 'running' | 'ready' | 'error',
    updates: { loadingPhase?: 'downloading' | 'preparing'; loadedBytes?: number } = {},
    errorMessage?: string,
  ): void {
    const definition = getStableAudioModelDefinition(model)
    const runtimeId = this.runtimeId(model)
    const now = Date.now()
    const existing = useLocalInferenceStore.getState().runtimesById[runtimeId]
    const runtime = {
      feature: 'audio',
      featureLabel: 'Stable Audio 3',
      modelKey: model,
      modelLabel: definition.label,
      backend: 'cpu' as const,
      state,
      estimatedBytes: definition.estimatedBytes,
      activeJobs: this.activeJobs.get(model) ?? 0,
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
        { unload: () => this.unloadModel(model) },
      )
    }
  }

  private incrementJobs(model: StableAudioModelId): void {
    this.activeJobs.set(model, (this.activeJobs.get(model) ?? 0) + 1)
    this.updateRuntime(model, 'running')
  }

  private decrementJobs(model: StableAudioModelId): void {
    this.activeJobs.set(model, Math.max(0, (this.activeJobs.get(model) ?? 0) - 1))
    this.updateRuntime(model, 'ready')
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

  async unloadModel(model: StableAudioModelId): Promise<void> {
    const api = getApi()
    if (api) await api.unload().catch(() => undefined)
    this.activeJobs.delete(model)
    localInferenceRuntimeRegistry.unregisterRuntime(this.runtimeId(model))
  }

  async generateMusicFile({
    prompt,
    model = DEFAULT_STABLE_AUDIO_MODEL,
    durationSeconds,
    guidanceScale = 3,
    onProgress,
    signal,
  }: GenerateMusicOptions): Promise<{ blob: Blob; file: File; duration: number }> {
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) throw new Error('请先描述想要生成的音频。')
    const api = getApi()
    if (!api) throw new Error('当前应用环境不支持本地音频生成。')
    if (signal?.aborted) throw createAbortError()
    const definition = getStableAudioModelDefinition(model)
    const clampedDuration = Math.min(
      definition.maxDurationSeconds,
      Math.max(definition.minDurationSeconds, durationSeconds),
    )

    return this.withGenerationLock(async () => {
      this.updateRuntime(model, 'loading')
      const requestId = crypto.randomUUID()
      let cancelled = false
      const cancel = () => {
        cancelled = true
        void api.cancel(requestId)
      }
      const unsubscribe = api.onProgress((progress) => {
        if (progress.requestId !== requestId) return
        this.handleProgress(progress)
        onProgress?.(
          progress.stage,
          progress.fraction ?? undefined,
          progress.stage === 'preparing-model' || progress.stage === 'downloading-model'
            ? 'preparing-model'
            : 'generating',
        )
      })
      signal?.addEventListener('abort', cancel, { once: true })
      this.incrementJobs(model)
      try {
        if (signal?.aborted) throw createAbortError()
        const result = await api.generate({
          requestId,
          model,
          prompt: trimmedPrompt,
          durationSeconds: clampedDuration,
          guidanceScale,
        })
        if (cancelled || signal?.aborted) throw createAbortError()
        const bytes = new Uint8Array(result.bytes)
        const blob = new Blob([bytes], { type: 'audio/wav' })
        const file = new File([blob], createOutputFileName(trimmedPrompt, model), {
          type: 'audio/wav',
          lastModified: Date.now(),
        })
        return { blob, file, duration: result.durationSeconds }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Stable Audio 3 ${model} generation failed`, error)
        this.updateRuntime(model, 'error', {}, message)
        throw error
      } finally {
        unsubscribe()
        signal?.removeEventListener('abort', cancel)
        this.decrementJobs(model)
      }
    })
  }

  handleProgress(progress: StableAudio3Progress): void {
    const phase: StableAudioGenerationPhase =
      progress.stage === 'preparing-model' || progress.stage === 'downloading-model'
        ? 'preparing-model'
        : 'generating'
    const loadingPhase = phase === 'preparing-model' ? 'downloading' as const : undefined
    this.updateRuntime(progress.model, phase === 'generating' ? 'running' : 'loading', {
      ...(loadingPhase ? { loadingPhase } : {}),
      ...(progress.fraction === null ? {} : { loadedBytes: progress.loadedBytes ?? undefined }),
    })
  }
}

export { DEFAULT_STABLE_AUDIO_MODEL, STABLE_AUDIO_MODEL_OPTIONS }
export type { StableAudioModelId }

export const stableAudio3Service = new StableAudio3Service()
