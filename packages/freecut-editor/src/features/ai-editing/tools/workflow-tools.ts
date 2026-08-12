import { z } from 'zod'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const finish = defineAiEditingTool({
  id: 'workflow.finish',
  title: '结束本轮任务',
  description: '明确声明本轮是已完成文本答复、已完成时间轴修改，还是因条件不足而停止。每轮只在真正结束时调用一次。',
  risk: 'read',
  inputSchema: objectSchema({
    outcome: {
      type: 'string',
      enum: ['responded', 'edited', 'blocked'],
      description: 'responded 表示交付文本；edited 表示已提交剪辑；blocked 表示当前无法继续。',
    },
    summary: { type: 'string', minLength: 1, maxLength: 300 },
    remainingWork: { type: 'string', minLength: 1, maxLength: 300 },
  }, ['outcome', 'summary']),
  schema: z.object({
    outcome: z.enum(['responded', 'edited', 'blocked']),
    summary: z.string().trim().min(1).max(300),
    remainingWork: z.string().trim().min(1).max(300).optional(),
  }),
  summarize: ({ outcome }) => `结束本轮任务：${outcome}`,
  execute: ({ outcome, summary, remainingWork }) => ({
    ok: true,
    message: summary,
    data: { outcome, summary, ...(remainingWork ? { remainingWork } : {}) },
  }),
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [finish],
}
