import { z } from 'zod'
import { buildProjectEvidence } from '../evidence'
import { buildAgentMediaCatalog } from '../workspace-document/build-workspace-document'
import { mediaIdsFromToolInput } from './media-reference'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const inspectProject = defineAiEditingTool({
  id: 'project.inspect',
  title: '查看时间轴总览',
  description: '读取当前时间轴的时长、轨道和片段数量总览。素材发现使用 media.list。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '查看当前项目',
  execute: async () => {
    const evidence = await buildProjectEvidence()
    return {
      ok: true,
      message: '已读取时间轴总览。',
      data: {
        timelineRevision: evidence.timelineRevision,
        fps: evidence.fps,
        durationSeconds: evidence.durationSeconds,
        playheadSeconds: evidence.playheadSeconds,
        selection: evidence.selection,
        tracks: evidence.tracks,
        clipCount: evidence.clips.length,
        mediaCount: evidence.media.length,
      },
    }
  },
})

const inspectTimelineContext = defineAiEditingTool({
  id: 'timeline.inspect_context',
  title: '读取时间轴上下文',
  description: '按时间范围或片段 ID 读取当前片段的轨道位置、源区间、速度、音量、裁切、变换、选中状态和效果摘要。',
  risk: 'read',
  inputSchema: objectSchema({
    startSeconds: { type: 'number', minimum: 0, description: '可选的时间范围起点。' },
    endSeconds: { type: 'number', minimum: 0, description: '可选的时间范围终点。' },
    clipIds: { type: 'array', items: { type: 'string' }, description: '可选的真实片段 ID，最多 20 个。' },
  }),
  schema: z.strictObject({
    startSeconds: z.number().min(0).optional(),
    endSeconds: z.number().min(0).optional(),
    clipIds: z.array(z.string().min(1)).max(20).optional(),
  }).refine((args) => args.endSeconds === undefined || args.startSeconds === undefined || args.endSeconds > args.startSeconds, {
    message: '时间范围终点必须晚于起点。',
  }),
  summarize: () => '读取时间轴上下文',
  execute: async (args) => {
    const evidence = await buildProjectEvidence()
    const ids = args.clipIds ? new Set(args.clipIds) : null
    const clips = evidence.clips.filter((clip) => {
      if (ids && !ids.has(clip.id)) return false
      if (args.startSeconds !== undefined && clip.endSeconds <= args.startSeconds) return false
      if (args.endSeconds !== undefined && clip.startSeconds >= args.endSeconds) return false
      return true
    })
    return {
      ok: true,
      message: `已读取 ${clips.length} 个片段的时间轴上下文。`,
      data: {
        timelineRevision: evidence.timelineRevision,
        fps: evidence.fps,
        durationSeconds: evidence.durationSeconds,
        playheadSeconds: evidence.playheadSeconds,
        selection: evidence.selection,
        tracks: evidence.tracks,
        clips,
      },
    }
  },
})

const listMedia = defineAiEditingTool({
  id: 'media.list',
  title: '列出项目素材',
  description: '分页列出当前项目素材及分析状态。先用它取得素材 ID，不需要浏览 media 目录。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({
    query: { type: 'string', minLength: 1, maxLength: 100 },
    kinds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', enum: ['video', 'audio', 'image', 'other'] },
    },
    cursor: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  }),
  schema: z.strictObject({
    query: z.string().trim().min(1).max(100).optional(),
    kinds: z.array(z.enum(['video', 'audio', 'image', 'other']))
      .min(1)
      .max(4)
      .refine((values) => new Set(values).size === values.length, '素材类型不能重复。')
      .optional(),
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  summarize: () => '列出项目素材',
  execute: async ({ query, kinds, cursor = 0, limit = 20 }) => {
    const mediaCatalog = await buildAgentMediaCatalog()
    const normalizedQuery = query?.toLocaleLowerCase()
    const allowedKinds = kinds ? new Set(kinds) : null
    const matches = mediaCatalog.filter((media) =>
      (!normalizedQuery || media.name.toLocaleLowerCase().includes(normalizedQuery)) &&
      (!allowedKinds || allowedKinds.has(media.kind)),
    )
    const items = matches.slice(cursor, cursor + limit).map((media) => ({
      id: media.ref.slice('media:'.length),
      name: media.name,
      kind: media.kind,
      duration: media.duration,
      width: media.width,
      height: media.height,
      hasAudio: media.hasAudio === true,
      evidence: {
        visualSampleCount: media.evidence.visual.length,
        hasTranscript: Boolean(media.evidence.transcript),
        audioAnalysis: media.evidence.audioAnalysis,
      },
    }))
    const nextCursor = cursor + items.length
    return {
      ok: true,
      message: `已列出 ${items.length}/${matches.length} 个项目素材。`,
      data: {
        cursor,
        nextCursor: nextCursor < matches.length ? nextCursor : null,
        total: matches.length,
        items,
      },
    }
  },
})

const readMediaEvidence = defineAiEditingTool({
  id: 'media.read',
  title: '读取素材证据',
  description: '按 media.list 返回的素材 ID 批量读取画面描述、口播摘要和节拍状态，不读取原始视频。完整口播使用 analysis.read_transcript。',
  risk: 'read',
  inputSchema: objectSchema({
    mediaIds: {
      type: 'array', minItems: 1, maxItems: 6, uniqueItems: true,
      items: { type: 'string', minLength: 1 },
      description: 'media.list 返回的素材 ID，最多 6 个。',
    },
    visualLimit: { type: 'integer', minimum: 1, maximum: 12, description: '每个素材最多返回的画面采样数，默认 8。' },
  }, ['mediaIds']),
  schema: z.strictObject({
    mediaIds: z.array(z.string().trim().min(1)).min(1).max(6)
      .refine((values) => {
        const normalized = mediaIdsFromToolInput(values)
        return normalized.every(Boolean) && new Set(normalized).size === normalized.length
      }, '素材 ID 不能为空或重复。'),
    visualLimit: z.number().int().min(1).max(12).optional(),
  }),
  summarize: (args) => `读取 ${args.mediaIds.length} 个素材的分析证据`,
  execute: async ({ mediaIds, visualLimit = 8 }) => {
    const requestedMediaIds = mediaIdsFromToolInput(mediaIds)
    const mediaById = new Map((await buildProjectEvidence()).media.map((item) => [item.mediaId, item]))
    const media = requestedMediaIds.flatMap((mediaId) => {
      const item = mediaById.get(mediaId)
      return item ? [{ ...item, visual: item.visual.slice(0, visualLimit) }] : []
    })
    const foundIds = new Set(media.map((item) => item.mediaId))
    const missingMediaIds = requestedMediaIds.filter((mediaId) => !foundIds.has(mediaId))
    return {
      ok: media.length > 0,
      message: media.length > 0
        ? `已读取 ${media.length} 个素材的分析证据${missingMediaIds.length > 0 ? `，另有 ${missingMediaIds.length} 个素材未找到` : ''}。`
        : '没有找到指定素材。',
      data: { requestedMediaIds, missingMediaIds, media },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [inspectProject, inspectTimelineContext, listMedia, readMediaEvidence],
}
