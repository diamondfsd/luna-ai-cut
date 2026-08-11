import { z } from 'zod'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const loadTools = defineAiEditingTool({
  id: 'tool.load',
  title: '加载工具',
  description: '根据精简工具目录加载当前任务需要的完整工具定义和参数。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      toolIds: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        uniqueItems: true,
        items: { type: 'string' },
      },
    },
    ['toolIds'],
  ),
  schema: z.strictObject({
    toolIds: z.array(z.string().min(1)).min(1).max(6).refine(
      (ids) => new Set(ids).size === ids.length,
      '工具 ID 不能重复。',
    ),
  }),
  summarize: ({ toolIds }) => `加载 ${toolIds.length} 个工具`,
  execute: ({ toolIds }, context) => {
    if (!context?.loadTools) {
      return { ok: false, message: '当前会话无法加载更多工具。' }
    }
    try {
      const data = context.loadTools(toolIds)
      return {
        ok: true,
        message: data.loaded.length > 0 ? '所需工具已加载。' : '这些工具已经加载。',
        data,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '工具加载失败。',
      }
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [loadTools],
}
