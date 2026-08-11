import type { Project } from '@freecut/types/project'
import { z } from 'zod'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import { summarizeTimelineProgram } from '../coding-workspace/timeline-session'
import { validateVirtualDirectoryPath } from '../coding-workspace/virtual-files-path'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

function summarizeBuild(artifact: Project) {
  return {
    projectId: artifact.id,
    projectName: artifact.name,
    ...summarizeTimelineProgram(artifact),
  }
}

function validDirectoryPath(path: string): boolean {
  try {
    validateVirtualDirectoryPath(path)
    return true
  } catch {
    return false
  }
}

const directoryPathSchema = z.string()
  .max(500)
  .transform((path) => path !== '' && !path.startsWith('/') ? path.replace(/\/+$/, '') : path)
  .refine(validDirectoryPath, '工程目录无效。')

const listWorkspace = defineAiEditingTool({
  id: 'workspace.list',
  title: '列出工程文件',
  description: '结构化列出剪辑源码或只读投影目录。素材发现优先使用 media.list。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      path: { type: 'string', maxLength: 500 },
      recursive: { type: 'boolean' },
      cursor: { type: 'integer', minimum: 0, maximum: 10_000 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
  ),
  schema: z.strictObject({
    path: directoryPathSchema.optional(),
    recursive: z.boolean().optional(),
    cursor: z.number().int().min(0).max(10_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  summarize: ({ path }) => `列出 ${path || '工程根目录'}`,
  execute: (args) => ({
    ok: true,
    message: '已列出工程文件。',
    data: getTimelineCodingSession().workspace.list(args),
  }),
})

const searchWorkspace = defineAiEditingTool({
  id: 'workspace.search',
  title: '搜索工程内容',
  description: '按固定文本搜索工程文件并返回路径和行号。素材内容优先使用 media.read。',
  risk: 'read',
  inputSchema: objectSchema({
    query: { type: 'string', minLength: 1, maxLength: 200 },
    path: { type: 'string', maxLength: 500 },
    caseSensitive: { type: 'boolean' },
    cursor: { type: 'integer', minimum: 0, maximum: 10_000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  }, ['query']),
  schema: z.strictObject({
    query: z.string().min(1).max(200),
    path: directoryPathSchema.optional(),
    caseSensitive: z.boolean().optional(),
    cursor: z.number().int().min(0).max(10_000).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  summarize: ({ query }) => `搜索“${query}”`,
  execute: (args) => ({
    ok: true,
    message: '已搜索工程内容。',
    data: getTimelineCodingSession().workspace.search(args),
  }),
})

const gitStatus = defineAiEditingTool({
  id: 'git.status',
  title: '查看源码状态',
  description: '查看当前分支、提交和未提交源码文件。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '查看源码状态',
  execute: async () => ({
    ok: true,
    message: '已读取源码状态。',
    data: await getTimelineCodingSession().repository.status(),
  }),
})

const gitDiff = defineAiEditingTool({
  id: 'git.diff',
  title: '核对源码改动',
  description: '读取当前剪辑源码相对最近提交的完整差异。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '核对源码改动',
  execute: async () => ({
    ok: true,
    message: '已读取源码改动。',
    data: await getTimelineCodingSession().repository.diff(),
  }),
})

const gitLog = defineAiEditingTool({
  id: 'git.log',
  title: '查看源码历史',
  description: '按数量读取最近的剪辑源码提交。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 50 } }),
  schema: z.strictObject({ limit: z.number().int().min(1).max(50).optional() }),
  summarize: () => '查看源码历史',
  execute: async ({ limit = 20 }) => ({
    ok: true,
    message: '已读取源码历史。',
    data: await getTimelineCodingSession().repository.log(limit),
  }),
})

const gitCommit = defineAiEditingTool({
  id: 'git.commit',
  title: '提交剪辑源码',
  description: '检查当前工程并把模块化剪辑源码提交到 Git 历史，作为本轮编辑的完成检查点。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({ message: { type: 'string', minLength: 1, maxLength: 200 } }, [
    'message',
  ]),
  schema: z.strictObject({ message: z.string().trim().min(1).max(200) }),
  summarize: ({ message }) => `提交源码：${message}`,
  execute: async ({ message }) => ({
    ok: true,
    message: '剪辑源码已提交。',
    data: await getTimelineCodingSession().commitSource(message),
  }),
})

const checkTimeline = defineAiEditingTool({
  id: 'timeline.check',
  title: '检查剪辑源码',
  description: '完整解析工程源码和引用，返回编译错误或项目摘要。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '检查剪辑源码',
  execute: async () => {
    const result = await getTimelineCodingSession().check()
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    return {
      ok,
      message: ok ? '剪辑源码检查通过。' : '剪辑源码需要修正。',
      data: {
        diagnostics: result.diagnostics,
        ...(result.artifact ? { project: summarizeBuild(result.artifact) } : {}),
      },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [
    listWorkspace,
    searchWorkspace,
    gitStatus,
    gitDiff,
    gitLog,
    gitCommit,
    checkTimeline,
  ],
}
