import { z } from 'zod'
import { getTranscript } from '@freecut/infrastructure/storage'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import { getMediaType } from '@freecut/features/media-library/utils/validation'
import type { MediaMetadata, MediaTranscript } from '@freecut/types/storage'
import type {
  ProjectEditingJsonSchema,
  ProjectEditingTool,
  ProjectEditingToolResult,
} from './project-source-tools'
import { AUDIO_TASK_TOOLS } from './project-source-audio-tasks'
import {
  activeMediaAnalysisProjectId,
  getMediaAnalysisTask,
  startMediaAnalysisTask,
} from './project-source-media-tasks'

const MAX_MEDIA_ITEMS = 500
const MAX_MEDIA_SELECTION = 12
const MAX_VISUAL_OBSERVATIONS = 24
const MAX_TRANSCRIPT_SEGMENTS = 200
const MAX_TRANSCRIPT_MATCHES = 40
const VISUAL_ANALYSIS_INTENSITIES = ['light', 'normal', 'strong'] as const

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): ProjectEditingJsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function validate<S extends z.ZodType>(input: unknown, value: S) {
  const result = value.safeParse(input ?? {})
  if (result.success) return { ok: true as const, value: result.data as Record<string, unknown> }
  const issue = result.error.issues[0]
  return { ok: false as const, error: `${issue?.path.join('.') || 'args'}: ${issue?.message || '参数无效'}` }
}

function tool<S extends z.ZodType>(input: {
  name: string
  description: string
  inputSchema: ProjectEditingJsonSchema
  schema: S
  execute: (args: z.infer<S>, signal?: AbortSignal) => Promise<ProjectEditingToolResult>
}): ProjectEditingTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    validate: (args) => validate(args, input.schema),
    execute: (args, signal) => input.execute(args as z.infer<S>, signal),
  }
}

function currentProject() {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error('当前没有打开的剪辑项目。')
  return project
}

async function projectMedia(): Promise<MediaMetadata[]> {
  const project = currentProject()
  const { mediaLibraryService } = await importMediaLibraryService()
  return mediaLibraryService.getMediaForProject(project.id)
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0
}

function sourceFingerprint(media: MediaMetadata): string {
  return media.contentHash ?? `${media.fileSize}:${media.fileLastModified ?? media.updatedAt}`
}

function mediaSummary(media: MediaMetadata): Record<string, unknown> {
  const mediaType = getMediaType(media.mimeType)
  return {
    id: media.id,
    fileName: media.fileName,
    mediaType,
    mimeType: media.mimeType,
    durationSeconds: round(media.duration),
    width: media.width,
    height: media.height,
    fps: media.fps,
    sizeBytes: media.fileSize,
    hasAudio: mediaType === 'audio' || Boolean(media.audioCodec),
    ...(media.codec ? { codec: media.codec } : {}),
    ...(media.audioCodec ? { audioCodec: media.audioCodec } : {}),
    ...(Number.isFinite(media.bitrate) ? { bitrate: media.bitrate } : {}),
  }
}

function wordCount(transcript: MediaTranscript): number {
  return transcript.segments.reduce((count, segment) => count + (segment.words?.length ?? 0), 0)
}

function visualObservations(media: MediaMetadata): Array<Record<string, unknown>> {
  return (media.aiCaptions ?? []).slice(0, MAX_VISUAL_OBSERVATIONS).map((caption) => ({
    timeSeconds: caption.timeSec,
    description: caption.text,
    subjects: caption.sceneData?.subjects ?? [],
    ...(caption.sceneData?.shotType ? { shotType: caption.sceneData.shotType } : {}),
    ...(caption.sceneData?.action ? { action: caption.sceneData.action } : {}),
    ...(caption.sceneData?.setting ? { setting: caption.sceneData.setting } : {}),
    ...(caption.sceneData?.lighting ? { lighting: caption.sceneData.lighting } : {}),
    ...(caption.sceneData?.timeOfDay ? { timeOfDay: caption.sceneData.timeOfDay } : {}),
    ...(caption.sceneData?.weather ? { weather: caption.sceneData.weather } : {}),
  }))
}

async function readMediaEvidence(media: MediaMetadata): Promise<Record<string, unknown>> {
  const transcript = await getTranscript(media.id).catch(() => undefined)
  const visual = visualObservations(media)

  return {
    ...mediaSummary(media),
    sourceFingerprint: sourceFingerprint(media),
    visual: {
      status: visual.length > 0 ? 'ready' : 'not-requested',
      samples: visual,
      ...(visual.length > 0 ? { model: 'lfm-2.5-vl' } : {}),
    },
    transcript: transcript
      ? {
          status: 'ready',
          language: transcript.language,
          model: transcript.model,
          segmentCount: transcript.segments.length,
          wordCount: wordCount(transcript),
          updatedAt: transcript.updatedAt,
          segments: transcript.segments.slice(0, MAX_TRANSCRIPT_SEGMENTS).map((segment) => ({
            startSeconds: segment.start,
            endSeconds: segment.end,
            text: segment.text,
          })),
          truncated: transcript.segments.length > MAX_TRANSCRIPT_SEGMENTS,
          ...(transcript.provenance ? { provenance: transcript.provenance } : {}),
        }
      : { status: 'not-requested', segments: [] },
  }
}

const mediaList = tool({
  name: 'media.list',
  description: '读取当前剪辑项目已关联素材的结构化信息，包括文件名、媒体类型、时长、尺寸、帧率、大小、编码和音频情况。不返回本地路径、文件句柄或素材内容。',
  inputSchema: schema({
    limit: { type: 'integer', minimum: 1, maximum: MAX_MEDIA_ITEMS },
  }),
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_MEDIA_ITEMS).optional(),
  }),
  execute: async (args) => {
    const mediaItems = await projectMedia()
    const limit = args.limit ?? MAX_MEDIA_ITEMS
    const items = mediaItems.slice(0, limit).map(mediaSummary)
    return {
      ok: true,
      message: `已读取当前项目的 ${mediaItems.length} 个素材。`,
      data: {
        total: mediaItems.length,
        truncated: mediaItems.length > limit,
        items,
      },
    }
  },
})

const mediaRead = tool({
  name: 'media.read',
  description: '按素材 ID 读取已经生成的画面理解和带时间点的口播字幕。画面理解来自 LFM2.5-VL-450M 的场景描述；没有完成分析时明确返回暂无结果，不会猜测内容。',
  inputSchema: schema({
    mediaIds: { type: 'array', minItems: 1, maxItems: MAX_MEDIA_SELECTION, items: { type: 'string' } },
  }, ['mediaIds']),
  schema: z.object({
    mediaIds: z.array(z.string().min(1)).min(1).max(MAX_MEDIA_SELECTION),
  }),
  execute: async (args) => {
    const requested = new Set(args.mediaIds)
    const mediaItems = await projectMedia()
    const found = mediaItems.filter((media) => requested.has(media.id))
    const foundIds = new Set(found.map((media) => media.id))
    const missingIds = args.mediaIds.filter((id) => !foundIds.has(id))
    const items = await Promise.all(found.map(readMediaEvidence))
    return {
      ok: found.length > 0,
      message: found.length > 0 ? `已读取 ${found.length} 个素材的分析证据。` : '没有找到指定素材。',
      data: { items, missingIds },
    }
  },
})

const mediaAnalyze = tool({
  name: 'media.analyze',
  description: '提交本地素材分析任务：transcript 识别口播字幕，visual 使用 LFM2.5-VL-450M 对视频或图片抽帧并生成带时间点的场景描述。调用会立即返回 taskId；必须使用 media.get_analysis_task 查询到 completed 或 failed，完成后再用 media.read 读取结果。visual 未指定 intensity 时默认使用较快的 light；需要更密集的画面描述时再传 normal 或 strong。',
  inputSchema: schema({
    mediaIds: { type: 'array', minItems: 1, maxItems: MAX_MEDIA_SELECTION, items: { type: 'string' } },
    kind: { type: 'string', enum: ['transcript', 'visual'] },
    intensity: { type: 'string', enum: VISUAL_ANALYSIS_INTENSITIES, default: 'light' },
  }, ['mediaIds', 'kind']),
  schema: z.object({
    mediaIds: z.array(z.string().min(1)).min(1).max(MAX_MEDIA_SELECTION),
    kind: z.enum(['transcript', 'visual']),
    intensity: z.enum(VISUAL_ANALYSIS_INTENSITIES).optional(),
  }),
  execute: async (args, signal) => {
    signal?.throwIfAborted()
    const requested = new Set(args.mediaIds)
    const mediaItems = await projectMedia()
    const found = mediaItems.filter((media) => requested.has(media.id))
    const task = startMediaAnalysisTask({
      projectId: activeMediaAnalysisProjectId(),
      mediaIds: args.mediaIds,
      mediaItems: found,
      kind: args.kind,
      intensity: args.intensity ?? 'light',
    })
    return {
      ok: found.length > 0,
      message: found.length > 0 ? '素材分析任务已提交，请查询 taskId。' : '没有找到要分析的素材。',
      data: task,
    }
  },
})

const mediaGetAnalysisTask = tool({
  name: 'media.get_analysis_task',
  description: '查询当前项目的素材分析任务。任务完成后读取 completedIds、skippedIds 和 failedIds；只有 status 为 completed 时才使用 media.read 获取已保存的分析结果，failed 时读取 error 和 failures。',
  inputSchema: schema({ taskId: { type: 'string', minLength: 1 } }, ['taskId']),
  schema: z.object({ taskId: z.string().trim().min(1) }),
  execute: async (args) => {
    const task = getMediaAnalysisTask(args.taskId, activeMediaAnalysisProjectId())
    const status = task.status
    return {
      ok: true,
      message: status === 'completed' ? '素材分析任务已完成。' : status === 'failed' ? '素材分析任务失败。' : '素材分析任务仍在处理中。',
      data: task,
    }
  },
})

const searchTranscript = tool({
  name: 'media.search_transcript',
  description: '在已生成的素材字幕中搜索词语或短语，返回命中的素材 ID、时间范围和原文。',
  inputSchema: schema({
    query: { type: 'string', minLength: 1 },
    mediaIds: { type: 'array', maxItems: MAX_MEDIA_SELECTION, items: { type: 'string' } },
  }, ['query']),
  schema: z.object({
    query: z.string().trim().min(1),
    mediaIds: z.array(z.string().min(1)).max(MAX_MEDIA_SELECTION).optional(),
  }),
  execute: async (args, signal) => {
    signal?.throwIfAborted()
    const query = args.query.toLocaleLowerCase()
    const allowedIds = args.mediaIds ? new Set(args.mediaIds) : undefined
    const matches: Array<Record<string, unknown>> = []
    for (const media of await projectMedia()) {
      signal?.throwIfAborted()
      if (allowedIds && !allowedIds.has(media.id)) continue
      const transcript = await getTranscript(media.id).catch(() => undefined)
      for (const segment of transcript?.segments ?? []) {
        if (!segment.text.toLocaleLowerCase().includes(query)) continue
        matches.push({
          mediaId: media.id,
          fileName: media.fileName,
          startSeconds: segment.start,
          endSeconds: segment.end,
          text: segment.text,
        })
        if (matches.length >= MAX_TRANSCRIPT_MATCHES) break
      }
      if (matches.length >= MAX_TRANSCRIPT_MATCHES) break
    }
    return {
      ok: true,
      message: matches.length > 0 ? `找到 ${matches.length} 处字幕内容。` : '没有找到对应字幕内容。',
      data: { query: args.query, matches, truncated: matches.length >= MAX_TRANSCRIPT_MATCHES },
    }
  },
})

export const MEDIA_AI_TOOLS: readonly ProjectEditingTool[] = [
  mediaList,
  mediaRead,
  mediaAnalyze,
  mediaGetAnalysisTask,
  searchTranscript,
  ...AUDIO_TASK_TOOLS,
]
