import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Info,
  ListPlus,
  Loader2,
  Pause,
  Play,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@freecut/components/ui/collapsible'
import { Label } from '@freecut/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@freecut/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@freecut/components/ui/select'
import { Slider } from '@freecut/components/ui/slider'
import { Textarea } from '@freecut/components/ui/textarea'
import {
  getStableAudioModelDefinition,
  STABLE_AUDIO_MODEL_OPTIONS,
  type StableAudioModelId,
} from '@freecut/shared/utils/stable-audio-models'
import { useMediaPlaybackControls } from '@freecut/shared/media/use-media-playback-controls'
import { SliderInput } from '@freecut/shared/ui/property-controls'
import { cn } from '@freecut/shared/ui/cn'
import { i18n } from '@freecut/i18n'
import {
  importMediaLibraryService,
  useMediaLibraryStore,
} from '@freecut/features/editor/deps/media-library'
import { usePlaybackStore } from '@freecut/shared/state/playback'
import type { MediaMetadata } from '@freecut/types/storage'
import {
  MOSS_TTS_VOICE_OPTIONS,
  getMossTtsVoiceOption,
  mossTtsService,
  type MossTtsVoice,
} from '../services/moss-tts-service'
import {
  DEFAULT_STABLE_AUDIO_MODEL,
  stableAudio3Service,
} from '../services/stable-audio-3-service'
import { insertGeneratedAudioOnNewTrack } from '../utils/insert-generated-audio'

const MUSIC_PROMPT_PRESETS = [
  {
    labelKey: 'editor.aiPanel.musicPresets.lofiChillLabel',
    promptKey: 'editor.aiPanel.musicPresets.lofiChillPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.pop80sLabel',
    promptKey: 'editor.aiPanel.musicPresets.pop80sPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.rock90sLabel',
    promptKey: 'editor.aiPanel.musicPresets.rock90sPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.upbeatEdmLabel',
    promptKey: 'editor.aiPanel.musicPresets.upbeatEdmPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.countryLabel',
    promptKey: 'editor.aiPanel.musicPresets.countryPrompt',
  },
  {
    labelKey: 'editor.aiPanel.musicPresets.lofiElectroLabel',
    promptKey: 'editor.aiPanel.musicPresets.lofiElectroPrompt',
  },
]

interface AudioGeneration {
  id: string
  file: File
  objectUrl: string
  byteSize: number
  duration: number
  textSnippet: string
  voice: string
  model: string
  summary: string
  details: string
  tags: string[]
  /** null = unsaved, string = saved media ID */
  savedMediaId: string | null
  saving: boolean
}

type Generation = AudioGeneration

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const MiniAudioPlayer = memo(function MiniAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const isSeekingRef = useRef(false)
  isSeekingRef.current = isSeeking

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onTimeUpdate = () => {
      if (!isSeekingRef.current) setCurrentTime(el.currentTime)
    }
    const onLoaded = () => setDuration(el.duration)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('loadedmetadata', onLoaded)
    el.addEventListener('ended', onEnded)

    return () => {
      el.pause()
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('loadedmetadata', onLoaded)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const { togglePlay, seekToPercent } = useMediaPlaybackControls(audioRef, duration, setCurrentTime)

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/30 px-1.5 py-1">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm glow-primary-sm transition-colors hover:bg-primary/90"
        onClick={togglePlay}
        aria-label={isPlaying ? i18n.t('preview.player.pause') : i18n.t('preview.player.play')}
      >
        {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3 ml-px" />}
      </button>
      <Slider
        value={[progressPercent]}
        onValueChange={(values) => {
          setIsSeeking(true)
          seekToPercent(values)
        }}
        onValueCommit={() => setIsSeeking(false)}
        max={100}
        step={0.1}
        className="min-w-0 flex-1"
        aria-label={i18n.t('editor.tts.seek')}
      />
      <span className="shrink-0 select-none font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatTime(currentTime)}
        <span className="text-muted-foreground/40"> / </span>
        {formatTime(duration)}
      </span>
    </div>
  )
})

export const AiPanel = memo(function AiPanel() {
  const { t } = useTranslation()
  const currentProjectId = useMediaLibraryStore((state) => state.currentProjectId)
  const loadMediaItems = useMediaLibraryStore((state) => state.loadMediaItems)
  const selectMedia = useMediaLibraryStore((state) => state.selectMedia)
  const showNotification = useMediaLibraryStore((state) => state.showNotification)

  const [ttsText, setTtsText] = useState(() => t('editor.aiPanel.defaultTtsPrompt'))
  const [ttsMossVoice, setTtsMossVoice] = useState<MossTtsVoice>('Xiaoyu')
  const [ttsSpeed, setTtsSpeed] = useState(1)
  const [isTtsGenerating, setIsTtsGenerating] = useState(false)
  const [ttsProgress, setTtsProgress] = useState<string | null>(null)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [ttsGenerations, setTtsGenerations] = useState<AudioGeneration[]>([])
  const [ttsSectionOpen, setTtsSectionOpen] = useState(true)

  const [musicPrompt, setMusicPrompt] = useState(() => t(MUSIC_PROMPT_PRESETS[0]!.promptKey))
  const [musicModel, setMusicModel] = useState<StableAudioModelId>(DEFAULT_STABLE_AUDIO_MODEL)
  const currentMusicModel = useMemo(() => getStableAudioModelDefinition(musicModel), [musicModel])
  const [musicDuration, setMusicDuration] = useState(currentMusicModel.defaultDurationSeconds)
  const [isMusicGenerating, setIsMusicGenerating] = useState(false)
  const [musicProgress, setMusicProgress] = useState<string | null>(null)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [musicGenerations, setMusicGenerations] = useState<AudioGeneration[]>([])
  const [musicProgressPct, setMusicProgressPct] = useState<number | null>(null)
  const [musicInfoOpen, setMusicInfoOpen] = useState(false)
  const [musicSectionOpen, setMusicSectionOpen] = useState(true)

  const musicAbortRef = useRef<AbortController | null>(null)
  const ttsTextareaRef = useRef<HTMLTextAreaElement>(null)
  const generationUrlsRef = useRef<Set<string>>(new Set())

  // Revoke all blob URLs on unmount
  useEffect(() => {
    setMusicDuration((previous) =>
      Math.min(
        currentMusicModel.maxDurationSeconds,
        Math.max(currentMusicModel.minDurationSeconds, previous),
      ),
    )
  }, [currentMusicModel.maxDurationSeconds, currentMusicModel.minDurationSeconds])

  // Abort in-flight generation and revoke all blob URLs on unmount
  useEffect(() => {
    const urls = generationUrlsRef.current
    return () => {
      musicAbortRef.current?.abort()
      musicAbortRef.current = null
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  const isMossSupported = mossTtsService.isSupported()
  const ttsSpeedMin = 0.5
  const ttsSpeedMax = 2

  useEffect(() => {
    setTtsSpeed((current) => Math.min(ttsSpeedMax, Math.max(ttsSpeedMin, current)))
  }, [ttsSpeedMax, ttsSpeedMin])

  const effectiveTtsSpeed = ttsSpeed
  const isTtsSupported = isMossSupported
  const isMusicSupported = stableAudio3Service.isSupported()
  const trimmedTtsText = ttsText.trim()
  const trimmedMusicPrompt = musicPrompt.trim()

  const totalTtsBytes = useMemo(
    () => ttsGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [ttsGenerations],
  )

  const totalMusicBytes = useMemo(
    () => musicGenerations.reduce((sum, generation) => sum + generation.byteSize, 0),
    [musicGenerations],
  )

  const anyTtsSaving = ttsGenerations.some((generation) => generation.saving)
  const anyMusicSaving = musicGenerations.some((generation) => generation.saving)
  const text = ttsText
  const setText = setTtsText
  const voice = ttsMossVoice
  const speed = ttsSpeed
  const setSpeed = setTtsSpeed
  const isGenerating = isTtsGenerating
  const progress = ttsProgress
  const error = ttsError
  const generations = ttsGenerations
  const totalBytes = totalTtsBytes
  const anySaving = anyTtsSaving
  const trimmedText = trimmedTtsText
  const currentTtsBackendLabel = 'CPU'
  const currentTtsRuntimeLabel = 'MOSS Nano'

  // --- actions ---

  const handleTtsGenerate = useCallback(async () => {
    if (!currentProjectId) {
      setTtsError(t('editor.tts.errors.openProject'))
      return
    }
    if (!trimmedTtsText) {
      setTtsError(t('editor.tts.errors.enterText'))
      return
    }
    if (!isTtsSupported) {
      setTtsError(t('editor.tts.errors.mossUnsupported'))
      return
    }

    setTtsError(null)
    setIsTtsGenerating(true)
    setTtsProgress(t('editor.tts.progressPreparing'))

    try {
      const result = await mossTtsService.generateSpeechFile({
        text: trimmedTtsText,
        voice: ttsMossVoice,
        speed: effectiveTtsSpeed,
        onProgress: setTtsProgress,
      })

      const { blob, file, duration } = result

      const objectUrl = URL.createObjectURL(blob)
      generationUrlsRef.current.add(objectUrl)
      const voiceLabel = getMossTtsVoiceOption(ttsMossVoice).label
      const modelLabel = 'Multilingual Nano'
      const engineTags = ['ai-generated', 'moss-tts', 'tts-engine:moss', `moss-voice:${ttsMossVoice}`]

      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedTtsText,
        voice: voiceLabel,
        model: modelLabel,
        summary: trimmedTtsText,
        details: `${voiceLabel} / ${modelLabel} / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: engineTags,
        savedMediaId: null,
        saving: false,
      }

      setTtsGenerations((prev) => [generation, ...prev])
      setTtsProgress(null)
    } catch (generationError) {
      setTtsError(
        generationError instanceof Error
          ? generationError.message
          : t('editor.tts.errors.generateFailed'),
      )
      setTtsProgress(null)
    } finally {
      setIsTtsGenerating(false)
    }
  }, [
    currentProjectId,
    effectiveTtsSpeed,
    isTtsSupported,
    trimmedTtsText,
    ttsMossVoice,
    t,
  ])

  const handleMusicGenerate = useCallback(async () => {
    if (!currentProjectId) return null
    if (!trimmedMusicPrompt) {
      setMusicError(t('editor.aiPanel.errors.describeMusic'))
      return null
    }
    if (!isMusicSupported) {
      setMusicError(t('editor.aiPanel.errors.stableAudioUnsupported'))
      return null
    }

    const abortController = new AbortController()
    musicAbortRef.current = abortController

    setMusicError(null)
    setIsMusicGenerating(true)
    setMusicProgress(t('editor.aiPanel.progressPreparingMusic'))
    setMusicProgressPct(null)

    try {
      const { blob, file, duration } = await stableAudio3Service.generateMusicFile({
        prompt: trimmedMusicPrompt,
        model: musicModel,
        durationSeconds: musicDuration,
        onProgress: (stage, fraction) => {
          setMusicProgress(stage)
          setMusicProgressPct(fraction ?? null)
        },
        signal: abortController.signal,
      })

      const objectUrl = URL.createObjectURL(blob)
      generationUrlsRef.current.add(objectUrl)

      const modelLabel =
        STABLE_AUDIO_MODEL_OPTIONS.find((option) => option.value === musicModel)?.label ?? musicModel
      const generation: AudioGeneration = {
        id: crypto.randomUUID(),
        file,
        objectUrl,
        byteSize: blob.size,
        duration,
        textSnippet: trimmedMusicPrompt,
        voice: modelLabel,
        model: `target ${musicDuration}s`,
        summary: trimmedMusicPrompt,
        details: `${modelLabel} / target ${musicDuration}s / ${duration > 0 ? `${duration.toFixed(1)}s` : '-'} / ${formatBytes(blob.size)}`,
        tags: [
          'ai-generated',
          'stable-audio-3',
          `stable-audio-model:${musicModel}`,
          `stable-audio-target:${musicDuration}s`,
        ],
        savedMediaId: null,
        saving: false,
      }

      setMusicGenerations((prev) => [generation, ...prev])
    } catch (generationError) {
      if (generationError instanceof DOMException && generationError.name === 'AbortError') {
        // Intentional cancellation — no error shown.
      } else {
        setMusicError(
          generationError instanceof Error
            ? generationError.message
            : t('editor.aiPanel.errors.generateMusicFailed'),
        )
      }
    } finally {
      musicAbortRef.current = null
      setIsMusicGenerating(false)
      setMusicProgress(null)
      setMusicProgressPct(null)
    }
  }, [currentProjectId, trimmedMusicPrompt, isMusicSupported, musicModel, musicDuration, t])

  const handleMusicCancel = useCallback(() => {
    musicAbortRef.current?.abort()
  }, [])

  const updateGenerationInList = useCallback(
    (
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      id: string,
      patch: Partial<AudioGeneration>,
    ) => {
      setGenerations((prev) =>
        prev.map((generation) => (generation.id === id ? { ...generation, ...patch } : generation)),
      )
    },
    [],
  )

  const saveGeneration = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ): Promise<MediaMetadata | null> => {
      if (!currentProjectId) return null
      updateGenerationInList(setGenerations, generation.id, { saving: true })

      try {
        const { mediaLibraryService } = await importMediaLibraryService()
        const media = await mediaLibraryService.importGeneratedAudio(
          generation.file,
          currentProjectId,
          {
            tags: generation.tags,
          },
        )

        await loadMediaItems()
        selectMedia([media.id])
        // Remove from tracked URLs so unmount cleanup won't revoke a URL
        // that may be referenced by a timeline item's src
        generationUrlsRef.current.delete(generation.objectUrl)
        updateGenerationInList(setGenerations, generation.id, {
          saving: false,
          savedMediaId: media.id,
        })
        return media
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : t('editor.aiPanel.errors.saveAudioFailed'),
        )
        updateGenerationInList(setGenerations, generation.id, { saving: false })
        return null
      }
    },
    [currentProjectId, loadMediaItems, selectMedia, t, updateGenerationInList],
  )

  const handleSave = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      const media = await saveGeneration(generation, setGenerations, setError)
      if (media) {
        showNotification({
          type: 'success',
          message: t('editor.aiPanel.notifications.savedToLibrary', {
            fileName: media.fileName,
          }),
        })
      }
    },
    [saveGeneration, showNotification, t],
  )

  const handleSaveAndInsert = useCallback(
    async (
      generation: AudioGeneration,
      setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>,
      setError: Dispatch<SetStateAction<string | null>>,
    ) => {
      // Saving is asynchronous, so capture the user's intended insertion point
      // when they click rather than after the media import finishes.
      const insertionFrame = usePlaybackStore.getState().currentFrame
      const media = await saveGeneration(generation, setGenerations, setError)
      if (!media) return

      const inserted = insertGeneratedAudioOnNewTrack(media, generation.objectUrl, insertionFrame)
      showNotification({
        type: inserted ? 'success' : 'warning',
        message: inserted
          ? t('editor.aiPanel.notifications.savedAndAdded', { fileName: media.fileName })
          : t('editor.tts.notifications.savedNoTrack', { fileName: media.fileName }),
      })
    },
    [saveGeneration, showNotification, t],
  )

  const removeGenerationFromList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>, id: string) => {
      setGenerations((prev) => {
        const generation = prev.find((entry) => entry.id === id)
        if (generation) {
          // Only revoke the blob URL if it has not been saved; saved items may
          // have their blob URL referenced by a timeline audio item's `src`.
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return prev.filter((entry) => entry.id !== id)
      })
    },
    [],
  )

  const clearGenerationList = useCallback(
    (setGenerations: Dispatch<SetStateAction<AudioGeneration[]>>) => {
      // Only revoke blob URLs for unsaved generations; saved ones may be
      // referenced by timeline items.
      setGenerations((prev) => {
        for (const generation of prev) {
          if (!generation.savedMediaId) {
            URL.revokeObjectURL(generation.objectUrl)
            generationUrlsRef.current.delete(generation.objectUrl)
          }
        }
        return []
      })
    },
    [],
  )

  const handleSaveTtsGeneration = useCallback(
    (generation: AudioGeneration) => handleSave(generation, setTtsGenerations, setTtsError),
    [handleSave],
  )
  const handleSaveAndInsertTtsGeneration = useCallback(
    (generation: AudioGeneration) =>
      handleSaveAndInsert(generation, setTtsGenerations, setTtsError),
    [handleSaveAndInsert],
  )
  const handleGenerate = handleTtsGenerate
  const handleClearAll = () => clearGenerationList(setTtsGenerations)
  const handleRemoveGeneration = (id: string) => removeGenerationFromList(setTtsGenerations, id)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-3">
        <Collapsible open={ttsSectionOpen} onOpenChange={setTtsSectionOpen}>
          <div className="-mx-3 -mt-3 bg-secondary/50 px-3 py-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                aria-label={
                  ttsSectionOpen
                    ? t('editor.aiPanel.collapseTextToSpeech')
                    : t('editor.aiPanel.expandTextToSpeech')
                }
              >
                <h2 className="text-sm font-medium">{t('editor.aiPanel.textToSpeech')}</h2>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    ttsSectionOpen && 'rotate-180',
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isTtsSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {t('editor.tts.mossUnsupported')}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ai-tts-text">{t('editor.tts.text')}</Label>
              <Textarea
                ref={ttsTextareaRef}
                id="ai-tts-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t('editor.tts.textPlaceholder')}
                className="min-h-24 resize-y bg-secondary/30 text-sm"
                disabled={isGenerating}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>{t('editor.tts.engine')}</Label>
                <span className="text-xs text-muted-foreground">{t('editor.tts.mossOption')}</span>
              </div>

              <div className="space-y-1.5">
                <Label>{t('editor.tts.voice')}</Label>
                <Select
                  value={voice}
                  onValueChange={(value) => setTtsMossVoice(value as MossTtsVoice)}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {MOSS_TTS_VOICE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <SliderInput
                label={t('editor.tts.speed')}
                value={speed}
                onChange={setSpeed}
                min={ttsSpeedMin}
                max={ttsSpeedMax}
                step={0.05}
                unit="x"
                disabled={isGenerating}
              />
              <Button
                size="sm"
                onClick={() => {
                  void handleGenerate()
                }}
                disabled={isGenerating || !trimmedText || !currentProjectId || !isTtsSupported}
                className="h-7 shrink-0 gap-1.5"
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isGenerating ? t('editor.tts.generating') : t('editor.tts.generate')}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('editor.aiPanel.runsLocally', {
                runtime: currentTtsRuntimeLabel,
                backend: currentTtsBackendLabel,
              })}
            </p>

            {progress && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                {progress}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}

            {generations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('editor.aiPanel.history', {
                      count: generations.length,
                      size: formatBytes(totalBytes),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={handleClearAll}
                    disabled={anySaving}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('editor.aiPanel.clearAll')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {generations.map((gen) => (
                    <GenerationRow
                      key={gen.id}
                      generation={gen}
                      onSave={handleSaveTtsGeneration}
                      onSaveAndInsert={handleSaveAndInsertTtsGeneration}
                      onRemove={handleRemoveGeneration}
                    />
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={musicSectionOpen} onOpenChange={setMusicSectionOpen}>
          <div className="-mx-3 bg-secondary/50 px-3 py-2">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-between gap-2 text-left"
                  aria-label={
                    musicSectionOpen
                      ? t('editor.aiPanel.collapseMusicGeneration')
                      : t('editor.aiPanel.expandMusicGeneration')
                  }
                >
                  <h2 className="text-sm font-medium">{t('editor.aiPanel.musicGeneration')}</h2>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 text-muted-foreground transition-transform',
                      musicSectionOpen && 'rotate-180',
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <Popover open={musicInfoOpen} onOpenChange={setMusicInfoOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t('editor.aiPanel.musicGenerationInfo')}
                    onMouseEnter={() => setMusicInfoOpen(true)}
                    onMouseLeave={() => setMusicInfoOpen(false)}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="bottom"
                  align="start"
                  className="w-72 space-y-2 p-3 text-xs"
                  onMouseEnter={() => setMusicInfoOpen(true)}
                  onMouseLeave={() => setMusicInfoOpen(false)}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      CPU
                    </span>
                    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Local
                    </span>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">
                    {t('editor.aiPanel.stableAudioDescription')}
                  </p>
                  <table className="w-full text-[11px]">
                    <tbody>
                      {STABLE_AUDIO_MODEL_OPTIONS.map((option) => (
                        <tr key={option.value} className="border-t border-border/50">
                          <td className="py-1 pr-2 font-medium text-foreground">{option.label}</td>
                          <td className="py-1 text-right text-muted-foreground">
                            {formatBytes(option.estimatedBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="leading-relaxed text-muted-foreground">
                    {t('editor.aiPanel.stableAudioPromptHint')}
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <CollapsibleContent className="space-y-4 pt-3">
            {!isMusicSupported && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                {t('editor.aiPanel.stableAudioUnsupported')}
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-music-prompt">{t('editor.aiPanel.prompt')}</Label>
                <Select
                  value=""
                  onValueChange={(value) => setMusicPrompt(value)}
                  disabled={isMusicGenerating}
                >
                  <SelectTrigger className="h-6 w-auto gap-1 border-none bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:text-foreground">
                    <SelectValue placeholder={t('editor.aiPanel.presets')} />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {MUSIC_PROMPT_PRESETS.map((preset) => (
                      <SelectItem
                        key={preset.labelKey}
                        value={t(preset.promptKey)}
                        className="text-xs"
                      >
                        {t(preset.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                id="ai-music-prompt"
                value={musicPrompt}
                onChange={(event) => setMusicPrompt(event.target.value)}
                placeholder={t('editor.aiPanel.musicPromptPlaceholder')}
                className="min-h-24 resize-y bg-secondary/30 text-sm"
                disabled={isMusicGenerating}
              />
            </div>

            <div className="flex items-center gap-2">
              <Select
                value={musicModel}
                onValueChange={(value) => setMusicModel(value as StableAudioModelId)}
                disabled={isMusicGenerating}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STABLE_AUDIO_MODEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SliderInput
                label={t('editor.aiPanel.length')}
                value={musicDuration}
                onChange={(value) => setMusicDuration(Math.round(value))}
                min={currentMusicModel.minDurationSeconds}
                max={currentMusicModel.maxDurationSeconds}
                step={1}
                unit="s"
                disabled={isMusicGenerating}
              />
              {isMusicGenerating && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMusicCancel}
                  className="h-7 shrink-0 gap-1.5 text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                  {t('common.cancel')}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  void handleMusicGenerate()
                }}
                disabled={
                  isMusicGenerating || !trimmedMusicPrompt || !currentProjectId || !isMusicSupported
                }
                className="h-7 shrink-0 gap-1.5"
              >
                {isMusicGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <WandSparkles className="h-3.5 w-3.5" />
                )}
                {isMusicGenerating ? t('editor.tts.generating') : t('editor.tts.generate')}
              </Button>
            </div>

            {musicProgress && (
              <div className="space-y-2 rounded-lg border border-border bg-secondary/20 p-3">
                <p className="text-xs text-muted-foreground">{musicProgress}</p>
                {musicProgressPct != null && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300 ease-linear"
                      style={{ width: `${Math.round(musicProgressPct * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {musicError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                {musicError}
              </div>
            )}

            {musicGenerations.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('editor.aiPanel.musicHistory', {
                      count: musicGenerations.length,
                      size: formatBytes(totalMusicBytes),
                    })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                    onClick={() => clearGenerationList(setMusicGenerations)}
                    disabled={anyMusicSaving}
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('editor.aiPanel.clearAll')}
                  </Button>
                </div>

                <div className="space-y-2">
                  {musicGenerations.map((generation) => (
                    <GenerationRow
                      key={generation.id}
                      generation={generation}
                      onSave={(entry) => handleSave(entry, setMusicGenerations, setMusicError)}
                      onSaveAndInsert={(entry) =>
                        handleSaveAndInsert(entry, setMusicGenerations, setMusicError)
                      }
                      onRemove={(id) => removeGenerationFromList(setMusicGenerations, id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  )
})

// --- Row component ---

const GenerationRow = memo(function GenerationRow({
  generation: gen,
  onSave,
  onSaveAndInsert,
  onRemove,
}: {
  generation: Generation
  onSave: (gen: Generation) => Promise<void>
  onSaveAndInsert: (gen: Generation) => Promise<void>
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const saved = gen.savedMediaId !== null

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${
        saved ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-secondary/20'
      }`}
    >
      {/* Meta row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="line-clamp-3 text-xs leading-relaxed" title={gen.textSnippet}>
            {gen.textSnippet}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {gen.voice} / {gen.model} / {gen.duration > 0 ? `${gen.duration.toFixed(1)}s` : '-'} /{' '}
            {formatBytes(gen.byteSize)}
          </p>
        </div>
        {!gen.saving && (
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={() => onRemove(gen.id)}
            aria-label={t('editor.aiPanel.remove')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Audio player */}
      <MiniAudioPlayer src={gen.objectUrl} />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {saved ? (
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            {t('editor.aiPanel.saved')}
          </span>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSaveAndInsert(gen)
              }}
              disabled={gen.saving}
            >
              {gen.saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListPlus className="h-3 w-3" />
              )}
              {gen.saving ? t('editor.aiPanel.saving') : t('editor.aiPanel.saveAndInsert')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={() => {
                void onSave(gen)
              }}
              disabled={gen.saving}
            >
              <Download className="h-3 w-3" />
              {t('editor.aiPanel.saveToLibrary')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
})
