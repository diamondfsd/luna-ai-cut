import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { getMediaType } from '@freecut/features/media-library/utils/validation'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { EmbeddedTranscriptResult } from '@freecut/shared/host/embedded-host'
import type { MediaMetadata, MediaTranscript } from '@freecut/types/storage'
import type { VisualAnalysisIntensity } from '@freecut/features/media-library/services/media-visual-analysis-service'

export type MediaAnalysisKind = 'transcript' | 'visual'
export type MediaAnalysisTaskStatus = 'queued' | 'analyzing' | 'completed' | 'failed'

export interface MediaAnalysisTaskInput {
  projectId: string
  mediaIds: readonly string[]
  mediaItems: readonly MediaMetadata[]
  kind: MediaAnalysisKind
  intensity: VisualAnalysisIntensity
}

interface MediaAnalysisTask {
  id: string
  projectId: string
  kind: MediaAnalysisKind
  intensity: VisualAnalysisIntensity
  mediaIds: string[]
  pendingIds: string[]
  completedIds: string[]
  skippedIds: string[]
  failedIds: string[]
  failures: Array<{ mediaId: string; error: string }>
  missingIds: string[]
  status: MediaAnalysisTaskStatus
  stage: string
  progress: number | null
  currentMediaId?: string
  createdAt: number
  updatedAt: number
  detailsKey: string
  error?: string
}

const tasks = new Map<string, MediaAnalysisTask>()

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的项目。')
  return projectId
}

function taskSnapshot(task: MediaAnalysisTask): Record<string, unknown> {
  return {
    taskId: task.id,
    kind: task.kind,
    intensity: task.intensity,
    status: task.status,
    stage: task.stage,
    progress: task.progress,
    mediaIds: task.mediaIds,
    pendingIds: task.pendingIds,
    completedIds: task.completedIds,
    skippedIds: task.skippedIds,
    failedIds: task.failedIds,
    failures: task.failures,
    missingIds: task.missingIds,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.currentMediaId ? { currentMediaId: task.currentMediaId } : {}),
    ...(task.error ? { error: task.error } : {}),
  }
}

function updateTask(
  task: MediaAnalysisTask,
  update: Partial<Pick<MediaAnalysisTask, 'status' | 'stage' | 'progress' | 'currentMediaId' | 'error'>>,
): void {
  Object.assign(task, update, { updatedAt: Date.now() })
}

function taskKey(input: MediaAnalysisTaskInput): string {
  return JSON.stringify({
    projectId: input.projectId,
    kind: input.kind,
    intensity: input.intensity,
    mediaIds: [...input.mediaIds].sort(),
  })
}

function activeTaskFor(input: MediaAnalysisTaskInput): MediaAnalysisTask | undefined {
  const key = taskKey(input)
  for (const task of tasks.values()) {
    if (task.status === 'completed' || task.status === 'failed') continue
    if (task.detailsKey === key) return task
  }
  return undefined
}

function mediaSource(media: MediaMetadata) {
  return {
    mediaId: media.id,
    fileName: media.fileName,
    fileSize: media.fileSize,
    fileLastModified: media.fileLastModified,
    mimeType: media.mimeType,
    durationSeconds: media.duration,
  }
}

function transcriptFromHostResult(media: MediaMetadata, result: EmbeddedTranscriptResult): MediaTranscript {
  const now = Date.now()
  return {
    id: media.id,
    mediaId: media.id,
    model: 'parakeet-tdt-v3',
    language: result.language,
    quantization: 'hybrid',
    text: result.cues.map((cue) => cue.text).join(' '),
    segments: result.cues.map((cue) => ({
      text: cue.text,
      start: cue.startSeconds,
      end: cue.endSeconds,
    })),
    createdAt: now,
    updatedAt: now,
    provenance: {
      service: 'luna-subtitle-service',
      modelId: result.model.id,
      modelVersion: result.model.version,
      sourceFingerprint: `${result.sourceFingerprint.size}:${result.sourceFingerprint.modifiedAtMs}`,
    },
  }
}

async function analyzeOne(
  task: MediaAnalysisTask,
  media: MediaMetadata,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  updateTask(task, {
    status: 'analyzing',
    stage: task.kind === 'visual' ? '正在分析画面。' : '正在识别口播。',
    currentMediaId: media.id,
  })

  const mediaType = getMediaType(media.mimeType)
  if (task.kind === 'visual') {
    if (mediaType !== 'video' && mediaType !== 'image') {
      task.skippedIds.push(media.id)
      return
    }
    const { analyzeMediaVisual } = await import('@freecut/features/media-library/services/media-visual-analysis-service')
    await analyzeMediaVisual(media, task.intensity, signal)
    return
  }

  if (mediaType !== 'video' && mediaType !== 'audio') {
    task.skippedIds.push(media.id)
    return
  }
  const host = getEmbeddedHostBridge()
  if (host.transcribeMedia) {
    const result = await host.transcribeMedia(mediaSource(media), undefined, signal)
    signal.throwIfAborted()
    const { mediaTranscriptionService } = await import('@freecut/features/media-library/services/media-transcription-service')
    await mediaTranscriptionService.adoptTranscript(transcriptFromHostResult(media, result))
    return
  }
  const { runMediaTranscriptionJob } = await import('@freecut/features/media-library/services/media-transcription-runner')
  await runMediaTranscriptionJob(media.id)
}

async function runTask(task: MediaAnalysisTask, mediaById: Map<string, MediaMetadata>): Promise<void> {
  const controller = new AbortController()
  try {
    const total = task.pendingIds.length
    for (const [index, mediaId] of task.pendingIds.entries()) {
      const media = mediaById.get(mediaId)
      if (!media) continue
      try {
        await analyzeOne(task, media, controller.signal)
        if (!task.skippedIds.includes(media.id)) task.completedIds.push(media.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        task.failedIds.push(media.id)
        task.failures.push({ mediaId: media.id, error: message })
      } finally {
        task.progress = total === 0 ? 1 : (index + 1) / total
        updateTask(task, {
          progress: task.progress,
          currentMediaId: undefined,
          stage: `已处理 ${index + 1}/${total} 个素材。`,
        })
      }
    }

    const hasResults = task.completedIds.length > 0 || task.skippedIds.length > 0
    updateTask(task, {
      status: hasResults ? 'completed' : 'failed',
      stage: hasResults ? '素材分析已完成。' : '素材分析失败。',
      progress: 1,
      ...(hasResults ? {} : { error: task.failures[0]?.error ?? '没有完成任何素材分析。' }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateTask(task, { status: 'failed', stage: '素材分析失败。', progress: null, error: message })
  }
}

export function startMediaAnalysisTask(input: MediaAnalysisTaskInput): Record<string, unknown> {
  const existing = activeTaskFor(input)
  if (existing) return taskSnapshot(existing)

  const requestedIds = [...input.mediaIds]
  const foundIds = new Set(input.mediaItems.map((media) => media.id))
  const missingIds = requestedIds.filter((mediaId) => !foundIds.has(mediaId))
  const pendingIds = input.mediaItems
    .filter((media) => requestedIds.includes(media.id))
    .filter((media) => {
      const mediaType = getMediaType(media.mimeType)
      return input.kind === 'visual'
        ? mediaType === 'video' || mediaType === 'image'
        : mediaType === 'video' || mediaType === 'audio'
    })
    .map((media) => media.id)
  const skippedIds = input.mediaItems
    .filter((media) => requestedIds.includes(media.id) && !pendingIds.includes(media.id))
    .map((media) => media.id)
  const now = Date.now()
  const task = {
    id: `media-analysis-task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    projectId: input.projectId,
    kind: input.kind,
    intensity: input.intensity,
    mediaIds: requestedIds,
    pendingIds,
    completedIds: [],
    skippedIds,
    failedIds: [],
    failures: [],
    missingIds,
    status: 'queued' as const,
    stage: '素材分析任务已提交，等待处理。',
    progress: pendingIds.length === 0 ? 1 : 0,
    createdAt: now,
    updatedAt: now,
    detailsKey: taskKey(input),
  }
  tasks.set(task.id, task)
  if (pendingIds.length === 0) {
    updateTask(task, {
      status: skippedIds.length > 0 || missingIds.length > 0 ? 'completed' : 'failed',
      stage: skippedIds.length > 0 || missingIds.length > 0 ? '没有需要处理的素材。' : '没有找到要分析的素材。',
      ...(skippedIds.length > 0 || missingIds.length > 0 ? {} : { error: '没有找到要分析的素材。' }),
    })
  } else {
    void runTask(task, new Map(input.mediaItems.map((media) => [media.id, media])))
  }
  return taskSnapshot(task)
}

export function getMediaAnalysisTask(taskId: string, projectId: string): Record<string, unknown> {
  const task = tasks.get(taskId)
  if (!task || task.projectId !== projectId) throw new Error('没有找到当前项目中的素材分析任务。')
  return taskSnapshot(task)
}

export const __mediaAnalysisTaskTestUtils = {
  clear: () => tasks.clear(),
}

export function activeMediaAnalysisProjectId(): string {
  return currentProjectId()
}
