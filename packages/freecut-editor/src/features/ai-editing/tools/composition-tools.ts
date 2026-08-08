import { z } from 'zod'
import { composeTimelineFromMedia } from '../media-composition-service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const composeFromMedia = defineAiEditingTool({
  id: 'timeline.compose_from_media',
  title: '编排素材库片段',
  description: '根据已完成的本地画面描述，选择素材库片段并依次加入时间轴末尾。不会覆盖现有内容。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          mediaId: { type: 'string', description: '素材库中的素材 ID。' },
          startSeconds: { type: 'number', minimum: 0, description: '选段起点，默认从开头开始。' },
          endSeconds: { type: 'number', minimum: 0, description: '选段终点，默认到素材结尾。' },
          durationSeconds: { type: 'number', exclusiveMinimum: 0, description: '图片在时间轴中的展示时长。' },
        },
        required: ['mediaId'],
      },
      description: '按成片顺序排列的素材选段，最多 12 段。',
    },
    startSeconds: { type: 'number', minimum: 0, description: '成片在时间轴中的起点，默认接在现有内容后。' },
    includeOriginalAudio: { type: 'boolean', description: '是否保留视频素材的原始声音。' },
  }, ['selections']),
  schema: z.object({
    selections: z.array(z.object({
      mediaId: z.string().min(1),
      startSeconds: z.number().min(0).optional(),
      endSeconds: z.number().min(0).optional(),
      durationSeconds: z.number().positive().optional(),
    }).refine(
      (selection) => selection.endSeconds === undefined
        || selection.startSeconds === undefined
        || selection.endSeconds > selection.startSeconds,
      '选段终点需要晚于起点。',
    )).min(1).max(12),
    startSeconds: z.number().min(0).optional(),
    includeOriginalAudio: z.boolean().default(true),
  }),
  summarize: (args) => `将 ${args.selections.length} 段素材编排到时间轴`,
  execute: composeTimelineFromMedia,
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [composeFromMedia],
}
