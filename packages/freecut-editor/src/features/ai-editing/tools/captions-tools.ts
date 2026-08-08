import { z } from 'zod'
import { mediaTranscriptionService } from '@freecut/features/media-library/services/media-transcription-service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const generateCaptions = defineAiEditingTool({
  id: 'captions.generate',
  title: '生成字幕',
  description: '把已识别的口播内容生成到时间轴字幕轨道。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({
    mediaId: { type: 'string', description: '已完成口播识别的素材。' },
    clipIds: { type: 'array', items: { type: 'string' }, description: '可选的时间轴片段范围。' },
    replaceExisting: { type: 'boolean', description: '是否替换该素材已有的自动字幕。' },
  }, ['mediaId']),
  schema: z.object({
    mediaId: z.string().min(1),
    clipIds: z.array(z.string()).optional(),
    replaceExisting: z.boolean().optional(),
  }),
  summarize: () => '生成时间轴字幕',
  execute: async (args) => {
    const result = await mediaTranscriptionService.insertTranscriptAsCaptions(args.mediaId, {
      clipIds: args.clipIds,
      replaceExisting: args.replaceExisting ?? true,
      selectUpdatedClips: true,
    })
    return {
      ok: true,
      message: result.insertedItemCount > 0 ? `已生成 ${result.insertedItemCount} 条字幕。` : '当前时间轴范围内没有可生成的字幕。',
      data: result,
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [generateCaptions],
}
