import { z } from 'zod'
import { MAX_RESULT_READ_CHARS } from '../tool-result-store'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const readResult = defineAiEditingTool({
  id: 'result.read',
  title: '读取详细结果',
  description: '按引用和字符位置读取过大的工具结果。仅在工具结果返回 resultId 时使用。',
  risk: 'read',
  inputSchema: objectSchema({
    resultId: { type: 'string', description: '工具结果返回的 resultId。' },
    offset: { type: 'integer', minimum: 0, description: '开始读取的字符位置，首次为 0。' },
    maxChars: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_RESULT_READ_CHARS,
      description: `本次最多读取的字符数，最大 ${MAX_RESULT_READ_CHARS}。`,
    },
  }, ['resultId']),
  schema: z.strictObject({
    resultId: z.string().min(1).max(80),
    offset: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(1).max(MAX_RESULT_READ_CHARS).optional(),
  }),
  summarize: ({ resultId }) => `读取详细结果 ${resultId}`,
  execute: (args, context) => context?.readToolResult
    ? context.readToolResult(args)
    : { ok: false, message: '这项详细结果已不可用，请重新执行原工具。' },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [readResult],
}
