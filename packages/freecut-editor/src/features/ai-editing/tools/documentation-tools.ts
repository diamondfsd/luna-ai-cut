import { z } from 'zod'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const documentationPath = z.string().regex(
  /^docs\/.+\.(?:md|ts)$/,
  '只能读取内置剪辑文档。',
)

const searchDocumentation = defineAiEditingTool({
  id: 'docs.search',
  title: '查询剪辑格式',
  description: '在当前 TypeScript 类型定义和工程格式说明中搜索字段或类型。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      query: { type: 'string', minLength: 1 },
      caseSensitive: { type: 'boolean' },
      cursor: { type: 'integer', minimum: 0, maximum: 10_000 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    ['query'],
  ),
  schema: z.strictObject({
    query: z.string().min(1).max(200),
    caseSensitive: z.boolean().optional(),
    cursor: z.number().int().min(0).max(10_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  summarize: ({ query }) => `查询字段“${query}”`,
  execute: (args) => ({
    ok: true,
    message: '已查询当前剪辑格式定义。',
    data: getTimelineCodingSession().workspace.search({ ...args, path: 'docs' }),
  }),
})

const readDocumentation = defineAiEditingTool({
  id: 'docs.read',
  title: '读取剪辑格式',
  description: '按行读取内置说明或项目实际使用的 TypeScript 类型源码。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      path: { type: 'string' },
      startLine: { type: 'integer', minimum: 1 },
      lineCount: { type: 'integer', minimum: 1, maximum: 400 },
    },
    ['path'],
  ),
  schema: z.strictObject({
    path: documentationPath,
    startLine: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
  }),
  summarize: ({ path }) => `读取 ${path}`,
  execute: ({ path, startLine = 1, lineCount = 200 }) => {
    const file = getTimelineCodingSession().workspace.read(path)
    const lines = file.content.split('\n')
    const content = lines.slice(startLine - 1, startLine - 1 + lineCount).join('\n')
    const nextStartLine = startLine - 1 + lineCount < lines.length
      ? startLine + lineCount
      : undefined
    return {
      ok: true,
      message: `已读取 ${path}。`,
      data: { path, startLine, totalLines: lines.length, nextStartLine, content },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [searchDocumentation, readDocumentation],
}
