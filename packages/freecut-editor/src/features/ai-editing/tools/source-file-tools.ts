import { z } from 'zod'
import { isEditingSourceFile } from '../coding-workspace/durable-source-repository'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const sourcePath = z.string().min(1).refine(isEditingSourceFile, '这个路径不是可编辑源码文件。')

const readSource = defineAiEditingTool({
  id: 'source.read',
  title: '读取工程源码',
  description: '从项目真实工作树读取一个源码文件的当前原文。替换失败后必须重新读取。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema(
    {
      path: { type: 'string' },
      startLine: { type: 'integer', minimum: 1 },
      lineCount: { type: 'integer', minimum: 1, maximum: 400 },
    },
    ['path'],
  ),
  schema: z.strictObject({
    path: sourcePath,
    startLine: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
  }),
  summarize: ({ path }) => `读取 ${path}`,
  execute: async ({ path, startLine = 1, lineCount = 200 }) => {
    const file = await getTimelineCodingSession().repository.readSource(path)
    const lines = file.content.split('\n')
    const startIndex = Math.min(startLine - 1, lines.length)
    const endIndex = Math.min(startIndex + lineCount, lines.length)
    return {
      ok: true,
      message: `已读取 ${path} 的当前原文。`,
      data: {
        path,
        size: file.size,
        startLine: startIndex + 1,
        endLine: endIndex,
        totalLines: lines.length,
        ...(endIndex < lines.length ? { nextLine: endIndex + 1 } : {}),
        content: lines.slice(startIndex, endIndex).join('\n'),
      },
    }
  },
})

const replaceSource = defineAiEditingTool({
  id: 'source.replace',
  title: '替换工程源码',
  description: '在真实工作树中校验并替换唯一原文；原文变化时拒绝覆盖，需重新读取。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema(
    {
      path: { type: 'string' },
      oldText: { type: 'string', minLength: 1 },
      newText: { type: 'string' },
      replaceAll: { type: 'boolean' },
    },
    ['path', 'oldText', 'newText'],
  ),
  schema: z.strictObject({
    path: sourcePath,
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  summarize: ({ path }) => `替换 ${path} 中的原文`,
  execute: async (args) => ({
    ok: true,
    message: '原文校验通过，工程源码已替换。',
    data: await getTimelineCodingSession().replaceSource(args),
  }),
})

const createSource = defineAiEditingTool({
  id: 'source.create',
  title: '创建工程源码',
  description: '在真实工作树创建一个不存在的模块文件，不覆盖已有文件。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema(
    { path: { type: 'string' }, content: { type: 'string' } },
    ['path', 'content'],
  ),
  schema: z.strictObject({ path: sourcePath, content: z.string() }),
  summarize: ({ path }) => `创建 ${path}`,
  execute: async ({ path, content }) => ({
    ok: true,
    message: '工程源码文件已创建。',
    data: await getTimelineCodingSession().createSource(path, content),
  }),
})

const removeSource = defineAiEditingTool({
  id: 'source.remove',
  title: '删除工程源码',
  description: '校验完整原文后从真实工作树删除源码文件。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema(
    { path: { type: 'string' }, oldText: { type: 'string', minLength: 1 } },
    ['path', 'oldText'],
  ),
  schema: z.strictObject({ path: sourcePath, oldText: z.string().min(1) }),
  summarize: ({ path }) => `删除 ${path}`,
  execute: async ({ path, oldText }) => ({
    ok: true,
    message: '原文校验通过，工程源码文件已删除。',
    data: await getTimelineCodingSession().removeSource(path, oldText),
  }),
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [readSource, replaceSource, createSource, removeSource],
}
