import { z } from 'zod'
import { buildProjectEvidence } from '../evidence'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const inspectProject = defineAiEditingTool({
  id: 'project.inspect',
  title: '查看剪辑内容',
  description: '读取时间轴和已分析素材的结构化摘要。不会读取或发送原始视频画面。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '查看当前项目',
  execute: async () => ({ ok: true, message: '已读取项目摘要。', data: await buildProjectEvidence() }),
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
  schema: z.object({
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

const inspectMediaEvidence = defineAiEditingTool({
  id: 'media.inspect_evidence',
  title: '读取素材证据',
  description: '按真实素材 ID 读取画面描述、字幕分析状态和节拍分析状态，用于进行有依据的剪辑判断。',
  risk: 'read',
  inputSchema: objectSchema({
    mediaIds: { type: 'array', items: { type: 'string' }, description: '项目快照中的素材 ID，最多 12 个。' },
  }, ['mediaIds']),
  schema: z.object({ mediaIds: z.array(z.string().min(1)).min(1).max(12) }),
  summarize: (args) => `读取 ${args.mediaIds.length} 个素材的分析证据`,
  execute: async (args) => {
    const requested = new Set(args.mediaIds)
    const media = (await buildProjectEvidence()).media.filter((item) => requested.has(item.mediaId))
    return {
      ok: media.length > 0,
      message: media.length > 0 ? `已读取 ${media.length} 个素材的分析证据。` : '没有找到指定素材。',
      data: { media },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [inspectProject, inspectTimelineContext, inspectMediaEvidence],
}
