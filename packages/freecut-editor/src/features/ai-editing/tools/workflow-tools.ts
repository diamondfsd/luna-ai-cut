import { z } from 'zod'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const setPlan = defineAiEditingTool({
  id: 'workflow.set_plan',
  title: '设置执行计划',
  description: '仅在复杂剪辑确实需要多个依赖阶段时，记录一份简短执行计划；不会启动子 Agent 或修改时间轴。',
  risk: 'read',
  inputSchema: objectSchema({
    steps: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: { type: 'string', minLength: 1, maxLength: 80 },
      description: '按依赖顺序排列的 2-4 个执行阶段，不按镜头或素材拆分。',
    },
  }, ['steps']),
  schema: z.object({ steps: z.array(z.string().trim().min(1).max(80)).min(2).max(4) }),
  summarize: ({ steps }) => `设置 ${steps.length} 个执行阶段`,
  execute: ({ steps }) => ({
    ok: true,
    message: `已记录 ${steps.length} 个执行阶段。`,
    data: { steps },
  }),
})

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
  createTools: () => [setPlan, finish],
}
