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

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [setPlan],
}
