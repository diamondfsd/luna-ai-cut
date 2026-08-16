import { z } from 'zod'
import { getEditingEvidence, getTranscript, saveVisualEditingEvidence } from '@freecut/infrastructure/storage'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { importMediaLibraryService } from '@freecut/features/media-library/services/media-library-service-loader'
import { getMediaType } from '@freecut/features/media-library/utils/validation'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import type { EmbeddedTranscriptResult } from '@freecut/shared/host/embedded-host'
import type { MediaMetadata, MediaTranscript } from '@freecut/types/storage'
import type {
  ProjectSourceJsonSchema,
  ProjectSourceTool,
  ProjectSourceToolResult,
} from './project-source-tools'

const MAX_MEDIA_ITEMS = 500
const MAX_MEDIA_SELECTION = 12
const MAX_VISUAL_OBSERVATIONS = 24
const MAX_TRANSCRIPT_SEGMENTS = 200
const MAX_TRANSCRIPT_MATCHES = 40
const VISUAL_ANALYSIS_INTENSITIES = ['light', 'normal', 'strong'] as const

function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): ProjectSourceJsonSchema {
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
  inputSchema: ProjectSourceJsonSchema
  schema: S
  execute: (args: z.infer<S>, signal?: AbortSignal) => Promise<ProjectSourceToolResult>
}): ProjectSourceTool {
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

function visualObservations(
  media: MediaMetadata,
  editingEvidence: Awaited<ReturnType<typeof getEditingEvidence>>,
): Array<Record<string, unknown>> {
  const captions = (media.aiCaptions ?? []).slice(0, MAX_VISUAL_OBSERVATIONS).map((caption) => ({
    timeSeconds: caption.timeSec,
    description: caption.text,
    subjects: caption.sceneData?.subjects ?? [],
    ...(caption.sceneData?.action ? { action: caption.sceneData.action } : {}),
  }))
  const localSamples = editingEvidence?.sourceFingerprint === sourceFingerprint(media)
    ? (editingEvidence.visual?.samples ?? []).slice(0, MAX_VISUAL_OBSERVATIONS).map((sample) => ({
        timeSeconds: sample.timeSeconds,
        description: sample.tags.join('、'),
        subjects: sample.tags,
      }))
    : []
  return [...captions, ...localSamples].slice(0, MAX_VISUAL_OBSERVATIONS)
}

async function readMediaEvidence(media: MediaMetadata): Promise<Record<string, unknown>> {
  const [transcript, editingEvidence] = await Promise.all([
    getTranscript(media.id).catch(() => undefined),
    getEditingEvidence(media.id).catch(() => undefined),
  ])
  const visual = visualObservations(media, editingEvidence)
  const matchingVisualEvidence = editingEvidence?.sourceFingerprint === sourceFingerprint(media)
    ? editingEvidence.visual
    : undefined

  return {
    ...mediaSummary(media),
    sourceFingerprint: sourceFingerprint(media),
    visual: {
      status: visual.length > 0 ? 'ready' : 'not-requested',
      samples: visual,
      ...(matchingVisualEvidence ? { models: matchingVisualEvidence.models } : {}),
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
  description: '按素材 ID 读取已经生成的画面理解和带时间点的口播字幕。画面理解来自本地模型抽帧；没有完成分析时明确返回暂无结果，不会猜测内容。',
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
  description: '使用本地模型分析指定素材：transcript 识别口播字幕，visual 对视频或图片抽帧并生成带时间点的画面描述。visual 未指定 intensity 时默认使用较快的 light；需要更密集的画面证据时再传 normal 或 strong。分析结果会保存，之后用 media.read 读取。',
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
    const requested = new Set(args.mediaIds)
    const mediaItems = await projectMedia()
    const found = mediaItems.filter((media) => requested.has(media.id))
    if (found.length === 0) {
      return { ok: false, message: '没有找到要分析的素材。', data: { completedIds: [], missingIds: args.mediaIds } }
    }

    const host = getEmbeddedHostBridge()
    const completedIds: string[] = []
    const skippedIds: string[] = []
    const { mediaTranscriptionService } = args.kind === 'transcript'
      ? await import('@freecut/features/media-library/services/media-transcription-service')
      : { mediaTranscriptionService: undefined }
    const { mediaAnalysisService } = args.kind === 'visual' && !host.analyzeMediaVisual
      ? await import('@freecut/features/media-library/services/media-analysis-service-loader').then((module) => module.importMediaAnalysisService())
      : { mediaAnalysisService: undefined }

    for (const media of found) {
      signal?.throwIfAborted()
      const mediaType = getMediaType(media.mimeType)
      if (args.kind === 'transcript') {
        if (mediaType !== 'video' && mediaType !== 'audio') {
          skippedIds.push(media.id)
          continue
        }
        if (host.transcribeMedia) {
          const result = signal
            ? await host.transcribeMedia(mediaSource(media), undefined, signal)
            : await host.transcribeMedia(mediaSource(media))
          signal?.throwIfAborted()
          await mediaTranscriptionService!.adoptTranscript(transcriptFromHostResult(media, result))
        } else {
          const { runMediaTranscriptionJob } = await import('@freecut/features/media-library/services/media-transcription-runner')
          await runMediaTranscriptionJob(media.id)
          signal?.throwIfAborted()
        }
        completedIds.push(media.id)
        continue
      }

      if (mediaType !== 'video' && mediaType !== 'image') {
        skippedIds.push(media.id)
        continue
      }
      if (host.analyzeMediaVisual) {
          const result = signal
            ? await host.analyzeMediaVisual(mediaSource(media), args.intensity ?? 'light', undefined, signal)
            : await host.analyzeMediaVisual(mediaSource(media), args.intensity ?? 'light')
          signal?.throwIfAborted()
          await saveVisualEditingEvidence(media.id, sourceFingerprint(media), {
          samples: result.samples,
          models: result.models,
          intensity: result.intensity,
        })
      } else {
        await mediaAnalysisService!.analyzeMedia(media)
      }
      signal?.throwIfAborted()
      completedIds.push(media.id)
    }

    const missingIds = args.mediaIds.filter((id) => !found.some((media) => media.id === id))
    return {
      ok: completedIds.length > 0,
      message: completedIds.length > 0
        ? `已完成 ${completedIds.length} 个素材的${args.kind === 'transcript' ? '口播识别' : '画面理解'}。`
        : '没有完成可用的素材分析。',
      data: { kind: args.kind, completedIds, skippedIds, missingIds },
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

export const MEDIA_AI_TOOLS: readonly ProjectSourceTool[] = [
  mediaList,
  mediaRead,
  mediaAnalyze,
  searchTranscript,
]
