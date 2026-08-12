import { z } from 'zod'
import { isEditingSourceFile } from '../coding-workspace/durable-source-repository'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const sourcePath = z.string().min(1).refine(isEditingSourceFile, '这个路径不是可编辑源码文件。')
const sourceRevision = z.string().regex(/^[a-f0-9]{64}$/, '源码版本无效，请重新读取文件。')

async function contentRevision(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

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
        revision: await contentRevision(file.content),
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
  title: '创建并写入工程源码',
  description: '一次调用同时命名、创建并写入一个不存在的模块文件，不覆盖已有文件；同时创建多个文件时改用 source.apply_changes。',
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
  description: '使用 source.read 返回的 revision 校验版本后删除源码文件。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema(
    { path: { type: 'string' }, revision: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    ['path', 'revision'],
  ),
  schema: z.strictObject({ path: sourcePath, revision: sourceRevision }),
  summarize: ({ path }) => `删除 ${path}`,
  execute: async ({ path, revision }) => ({
    ok: true,
    message: '原文校验通过，工程源码文件已删除。',
    data: await getTimelineCodingSession().removeSource(path, revision),
  }),
})

const sourceChange = z.strictObject({
  path: sourcePath,
  revision: sourceRevision.nullable(),
  content: z.string().nullable(),
})

const MAX_SOURCE_CHANGES_PER_BATCH = 4

const applySourceChanges = defineAiEditingTool({
  id: 'source.apply_changes',
  title: '批量创建或修改工程源码',
  description: '一次原子调用同时命名并写入、修改或删除最多 4 个相关源码文件。轨道和片段由目录自动发现，不需要维护路径索引。新文件使用 revision: null 和完整 content，已有文件使用 source.read 返回的 revision；整批全部成功或全部不生效。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema(
    {
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SOURCE_CHANGES_PER_BATCH,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            revision: { type: ['string', 'null'], pattern: '^[a-f0-9]{64}$' },
            content: { type: ['string', 'null'] },
          },
          required: ['path', 'revision', 'content'],
          additionalProperties: false,
        },
      },
    },
    ['changes'],
  ),
  schema: z.strictObject({
    changes: z.array(sourceChange).min(1).max(MAX_SOURCE_CHANGES_PER_BATCH),
  }),
  summarize: ({ changes }) => `批量修改 ${(changes as unknown[]).length} 个源码文件`,
  execute: async ({ changes }) => ({
    ok: true,
    message: '工程源码已完成原子批量修改。',
    data: await getTimelineCodingSession().applySourceChanges(changes.map((change) => ({
      path: change.path,
      content: change.content,
      expectedRevision: change.revision,
    }))),
  }),
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [readSource, replaceSource, createSource, removeSource, applySourceChanges],
}
