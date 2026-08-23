import type { MediaMetadata } from '@freecut/types/storage'
import type { CaptionTimeRange } from '@freecut/infrastructure/analysis/media-tagger'
import { useMediaLibraryStore } from '@freecut/features/media-library/stores/media-library-store'
import { importMediaAnalysisService } from '@freecut/features/media-library/services/media-analysis-service-loader'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import { runMediaTranscriptionJob } from '@freecut/features/media-library/services/media-transcription-runner'
import { getMediaType } from '@freecut/features/media-library/utils/validation'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'

type MediaAnalysisKind = 'transcript' | 'visual'
type MediaTaskStatus = 'queued' | 'running' | 'completed' | 'failed'
type AudioTaskKind = 'speech' | 'music'
type AudioTaskStatus =
  | 'queued'
  | 'preparing-model'
  | 'generating'
  | 'saving'
  | 'completed'
  | 'failed'

interface MediaAnalysisTask {
  id: string
  projectId: string
  kind: MediaAnalysisKind
  mediaIds: string[]
  pendingIds: string[]
  completedIds: string[]
  skippedIds: string[]
  failedIds: string[]
  failures: Array<{ mediaId: string; error: string }>
  missingIds: string[]
  error?: string
  status: MediaTaskStatus
  stage: string
  progress: number | null
  createdAt: number
  updatedAt: number
  visualTimeRanges?: CaptionTimeRange[]
}

interface AudioTask {
  id: string
  projectId: string
  kind: AudioTaskKind
  status: AudioTaskStatus
  stage: string
  progress: number | null
  createdAt: number
  updatedAt: number
  mediaId?: string
  fileName?: string
  durationSeconds?: number
  error?: string
  details: Record<string, unknown>
}

const mediaTasks = new Map<string, MediaAnalysisTask>()
const audioTasks = new Map<string, AudioTask>()

function createTaskId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mediaTaskSnapshot(task: MediaAnalysisTask): Record<string, unknown> {
  return {
    ...task,
    mediaIds: [...task.mediaIds],
    pendingIds: [...task.pendingIds],
    completedIds: [...task.completedIds],
    skippedIds: [...task.skippedIds],
    failedIds: [...task.failedIds],
    failures: task.failures.map((failure) => ({ ...failure })),
    ...(task.visualTimeRanges
      ? { visualTimeRanges: task.visualTimeRanges.map((range) => ({ ...range })) }
      : {}),
    taskId: task.id,
  }
}

function audioTaskSnapshot(task: AudioTask): Record<string, unknown> {
  return {
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.mediaId ? { mediaId: task.mediaId } : {}),
    ...(task.fileName ? { fileName: task.fileName } : {}),
    ...(task.durationSeconds !== undefined ? { durationSeconds: task.durationSeconds } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...task.details,
  }
}

function updateMediaTask(task: MediaAnalysisTask, update: Partial<MediaAnalysisTask>): void {
  Object.assign(task, update, { updatedAt: Date.now() })
}

function updateAudioTask(task: AudioTask, update: Partial<AudioTask>): void {
  Object.assign(task, update, { updatedAt: Date.now() })
}

function mediaTaskKey(input: {
  projectId: string
  kind: MediaAnalysisKind
  mediaIds: readonly string[]
  visualTimeRanges?: readonly CaptionTimeRange[]
}): string {
  return `${input.projectId}:${input.kind}:${[...input.mediaIds].sort().join(',')}:${JSON.stringify(input.visualTimeRanges ?? null)}`
}

function mediaCanBeAnalyzed(media: MediaMetadata, kind: MediaAnalysisKind): boolean {
  const type = getMediaType(media.mimeType)
  return kind === 'visual'
    ? type === 'video' || type === 'image'
    : type === 'video' || type === 'audio'
}

function startMediaTaskRun(task: MediaAnalysisTask, mediaById: Map<string, MediaMetadata>): void {
  void (async () => {
    updateMediaTask(task, {
      status: 'running',
      stage: '正在处理素材分析任务。',
      progress: task.pendingIds.length === 0 ? 1 : 0,
    })

    for (const [index, mediaId] of task.pendingIds.entries()) {
      const media = mediaById.get(mediaId)
      if (!media) continue

      updateMediaTask(task, {
        stage: `正在处理 ${media.fileName}。`,
        progress: task.pendingIds.length === 0 ? 1 : index / task.pendingIds.length,
      })

      try {
        if (task.kind === 'visual') {
          const { mediaAnalysisService } = await importMediaAnalysisService()
          if (
            !(await mediaAnalysisService.analyzeMedia(media, {
              visualTimeRanges: task.visualTimeRanges,
            }))
          ) {
            task.failedIds.push(media.id)
            task.failures.push({ mediaId: media.id, error: '素材画面分析未完成。' })
          } else {
            task.completedIds.push(media.id)
          }
        } else {
          const result = await runMediaTranscriptionJob(media.id, {
            updateProgress: false,
            onProgress: (progress) =>
              updateMediaTask(task, {
                stage: progress.stage,
                progress:
                  (index + Math.max(0, Math.min(1, progress.progress))) / task.pendingIds.length,
              }),
          })
          if (result.status === 'completed') task.completedIds.push(media.id)
          else task.skippedIds.push(media.id)
        }
      } catch (error) {
        task.failedIds.push(media.id)
        task.failures.push({ mediaId: media.id, error: errorMessage(error) })
      }

      updateMediaTask(task, {
        progress: (index + 1) / task.pendingIds.length,
        stage: `已处理 ${index + 1}/${task.pendingIds.length} 个素材。`,
      })
    }

    const hasSuccess = task.completedIds.length > 0 || task.skippedIds.length > 0
    updateMediaTask(task, {
      status: hasSuccess ? 'completed' : 'failed',
      progress: 1,
      stage: hasSuccess ? '素材分析任务已完成。' : '素材分析任务失败。',
      ...(hasSuccess ? {} : { error: task.failures[0]?.error ?? '没有完成任何素材分析。' }),
    })
  })().catch((error) =>
    updateMediaTask(task, {
      status: 'failed',
      progress: 1,
      stage: '素材分析任务失败。',
      error: errorMessage(error),
      failures: [...task.failures, { mediaId: '', error: errorMessage(error) }],
    }),
  )
}

export function startMediaAnalysisTask(input: {
  projectId: string
  mediaIds: readonly string[]
  mediaItems: readonly MediaMetadata[]
  kind: MediaAnalysisKind
  visualTimeRanges?: readonly CaptionTimeRange[]
}): Record<string, unknown> {
  const mediaIds = [...new Set(input.mediaIds)]
  const key = mediaTaskKey({
    projectId: input.projectId,
    kind: input.kind,
    mediaIds,
    visualTimeRanges: input.visualTimeRanges,
  })
  const existing = [...mediaTasks.values()].find((task) =>
    task.status === 'queued' || task.status === 'running'
      ? mediaTaskKey(task) === key
      : false,
  )
  if (existing) return mediaTaskSnapshot(existing)

  const byId = new Map(input.mediaItems.map((media) => [media.id, media]))
  const missingIds = mediaIds.filter((mediaId) => !byId.has(mediaId))
  const pendingIds = mediaIds.filter((mediaId) => {
    const media = byId.get(mediaId)
    return media ? mediaCanBeAnalyzed(media, input.kind) : false
  })
  const skippedIds = mediaIds.filter((mediaId) => {
    const media = byId.get(mediaId)
    return Boolean(media) && !mediaCanBeAnalyzed(media!, input.kind)
  })
  const now = Date.now()
  const task: MediaAnalysisTask = {
    id: createTaskId('media-analysis-task'),
    projectId: input.projectId,
    kind: input.kind,
    mediaIds,
    pendingIds,
    completedIds: [],
    skippedIds,
    failedIds: [],
    failures: [],
    missingIds,
    status: pendingIds.length > 0 ? 'queued' : skippedIds.length > 0 ? 'completed' : 'failed',
    stage: pendingIds.length > 0 ? '素材分析任务已提交。' : '没有找到需要处理的素材。',
    progress: pendingIds.length > 0 ? 0 : 1,
    createdAt: now,
    updatedAt: now,
    ...(input.visualTimeRanges
      ? { visualTimeRanges: input.visualTimeRanges.map((range) => ({ ...range })) }
      : {}),
    ...(pendingIds.length === 0 && missingIds.length > 0 ? { error: '没有找到请求的素材。' } : {}),
  }
  mediaTasks.set(task.id, task)
  if (pendingIds.length > 0) startMediaTaskRun(task, byId)
  return mediaTaskSnapshot(task)
}

export function getMediaAnalysisTask(taskId: string, projectId: string): Record<string, unknown> {
  const task = mediaTasks.get(taskId)
  if (!task || task.projectId !== projectId) throw new Error('没有找到当前项目中的素材分析任务。')
  return mediaTaskSnapshot(task)
}

function startAudioTaskRun(task: AudioTask, run: () => Promise<void>): void {
  void run().catch((error) =>
    updateAudioTask(task, {
      status: 'failed',
      progress: null,
      stage: '音频生成任务失败。',
      error: errorMessage(error),
    }),
  )
}

function deferAudioTaskRun(task: AudioTask, run: () => Promise<void>): void {
  // Return the queued task to the SDK caller before entering the host IPC
  // bridge. A model can submit audio and immediately poll the task; starting
  // IPC in the same call stack can hold the editor SDK request queue open.
  setTimeout(() => startAudioTaskRun(task, run), 0)
}

async function saveGeneratedAudio(
  projectId: string,
  result: { fileName: string; durationSeconds: number; bytes: Uint8Array },
  tags: string[],
): Promise<MediaMetadata> {
  const bytes = new Uint8Array(result.bytes)
  const file = new File([bytes], result.fileName, { type: 'audio/wav', lastModified: Date.now() })
  const { mediaLibraryService } = await importMediaLibraryService()
  const media = await mediaLibraryService.importGeneratedAudio(file, projectId, { tags })
  await useMediaLibraryStore.getState().loadMediaItems()
  return media
}

export function startAudioTask(input: {
  projectId: string
  kind: AudioTaskKind
  text?: string
  voice?: string
  speed?: number
  prompt?: string
  model?: 'small-music' | 'small-sfx'
  durationSeconds?: number
  guidanceScale?: number
}): Record<string, unknown> {
  const now = Date.now()
  const task: AudioTask = {
    id: createTaskId('audio-task'),
    projectId: input.projectId,
    kind: input.kind,
    status: 'queued',
    stage: '音频生成任务已提交。',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    details:
      input.kind === 'speech'
        ? { engine: 'moss-tts', voice: input.voice, speed: input.speed }
        : {
            engine: 'stable-audio-3',
            model: input.model,
            targetDurationSeconds: input.durationSeconds,
            guidanceScale: input.guidanceScale,
          },
  }
  audioTasks.set(task.id, task)
  const bridge = getEmbeddedHostBridge()

  deferAudioTaskRun(task, async () => {
    if (input.kind === 'speech') {
      if (!bridge.generateSpeech) throw new Error('当前宿主未接入语音生成服务。')
      updateAudioTask(task, {
        status: 'preparing-model',
        stage: '正在准备语音模型。',
        progress: null,
      })
      const result = await bridge.generateSpeech(
        {
          requestId: task.id,
          text: input.text!,
          voice: input.voice!,
          speed: input.speed!,
        },
        (progress) =>
          updateAudioTask(task, {
            status: progress.percent === null ? 'preparing-model' : 'generating',
            stage: progress.label,
            progress: progress.percent === null ? null : progress.percent / 100,
          }),
      )
      updateAudioTask(task, { status: 'saving', stage: '正在保存生成的语音。', progress: null })
      const media = await saveGeneratedAudio(input.projectId, result, [
        'ai-generated',
        'moss-tts',
        'tts-engine:moss',
        `moss-voice:${input.voice}`,
      ])
      updateAudioTask(task, {
        status: 'completed',
        stage: '语音已生成并保存。',
        progress: 1,
        mediaId: media.id,
        fileName: media.fileName,
        durationSeconds: media.duration,
      })
      return
    }

    if (!bridge.generateMusic) throw new Error('当前宿主未接入音乐生成服务。')
    updateAudioTask(task, {
      status: 'preparing-model',
      stage: '正在准备音频模型。',
      progress: null,
    })
    const result = await bridge.generateMusic(
      {
        requestId: task.id,
        model: input.model!,
        prompt: input.prompt!,
        durationSeconds: input.durationSeconds!,
        guidanceScale: input.guidanceScale!,
      },
      (progress) =>
        updateAudioTask(task, {
          status: progress.percent === null ? 'preparing-model' : 'generating',
          stage: progress.label,
          progress: progress.percent === null ? null : progress.percent / 100,
        }),
    )
    updateAudioTask(task, { status: 'saving', stage: '正在保存生成的音频。', progress: null })
    const media = await saveGeneratedAudio(input.projectId, result, [
      'ai-generated',
      'stable-audio-3',
      `stable-audio-model:${input.model}`,
      `stable-audio-target:${input.durationSeconds}s`,
    ])
    updateAudioTask(task, {
      status: 'completed',
      stage: '音频已生成并保存。',
      progress: 1,
      mediaId: media.id,
      fileName: media.fileName,
      durationSeconds: media.duration,
    })
  })

  return audioTaskSnapshot(task)
}

export function getAudioTask(taskId: string, projectId: string): Record<string, unknown> {
  const task = audioTasks.get(taskId)
  if (!task || task.projectId !== projectId) throw new Error('没有找到当前项目的音频生成任务。')
  return audioTaskSnapshot(task)
}

export const __freecutAiTaskTestUtils = {
  clear: () => {
    mediaTasks.clear()
    audioTasks.clear()
  },
}
