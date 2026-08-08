import { z } from 'zod'
import { describeAiEditingTools, searchAiEditingTools } from '../tool-discovery'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: (context) => {
    const describeSchema = z.object({ toolIds: z.array(z.string().min(1)).min(1).max(8) })
    const describeTools = defineAiEditingTool({
      id: 'tool.describe',
      title: '查看剪辑能力',
      description: '按工具 ID 获取剪辑能力详情，并在下一步开放对应操作。不会修改项目内容。',
      risk: 'read',
      inputSchema: objectSchema({
        toolIds: {
          type: 'array',
          items: { type: 'string' },
          description: '工具清单中的工具 ID，最多 8 个。',
        },
      }, ['toolIds']),
      schema: describeSchema,
      summarize: (args) => `查看 ${args.toolIds.length} 项剪辑能力`,
      execute: (args) => {
        const matches = describeAiEditingTools(args.toolIds, context.listTools())
        return {
          ok: matches.length > 0,
          message: matches.length > 0 ? `已准备 ${matches.length} 项剪辑能力。` : '没有找到指定的剪辑能力。',
          data: { tools: matches },
        }
      },
    })

    const searchSchema = z.object({ query: z.string().min(1).max(300) })
    const searchTools = defineAiEditingTool({
      id: 'tool.search',
      title: '查找剪辑能力',
      description: '按剪辑目标查找匹配的工具 ID，并在下一步开放对应操作。不会修改项目内容。',
      risk: 'read',
      inputSchema: objectSchema({
        query: { type: 'string', description: '要完成的剪辑目标或操作描述。' },
      }, ['query']),
      schema: searchSchema,
      summarize: (args) => `查找“${args.query}”相关的剪辑能力`,
      execute: (args) => {
        const matches = searchAiEditingTools(args.query, context.listTools())
        return {
          ok: matches.length > 0,
          message: matches.length > 0 ? `找到 ${matches.length} 项可用的剪辑能力。` : '没有找到匹配的剪辑能力。',
          data: { tools: matches },
        }
      },
    })

    return [describeTools, searchTools]
  },
}
