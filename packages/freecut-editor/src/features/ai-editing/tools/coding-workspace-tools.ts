import { z } from 'zod'
import { summarizeTimelineProgram } from '../coding-workspace/timeline-session'
import type { Project } from '@freecut/types/project'
import type { AiEditingToolModule } from '../types'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import { defineAiEditingTool, objectSchema } from './tool-utils'

function summarizeBuild(artifact: Project) {
  return {
    projectId: artifact.id,
    projectName: artifact.name,
    ...summarizeTimelineProgram(artifact),
  }
}

const listFiles = defineAiEditingTool({
  id: 'workspace.list',
  title: '列出剪辑源码文件',
  description: '列出虚拟剪辑仓库中的目录或文件，不读取文件正文。',
  risk: 'read',
  inputSchema: objectSchema({
    path: { type: 'string' },
    recursive: { type: 'boolean' },
    cursor: { type: 'integer', minimum: 0, maximum: 10_000 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
  }),
  schema: z.strictObject({
    path: z.string().optional(),
    recursive: z.boolean().optional(),
    cursor: z.number().int().min(0).max(10_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  summarize: ({ path }) => `列出 ${path || '仓库根目录'}`,
  execute: (args) => ({
    ok: true,
    message: '已列出剪辑源码文件。',
    data: getTimelineCodingSession().workspace.list(args),
  }),
})

const readFile = defineAiEditingTool({
  id: 'workspace.read',
  title: '读取剪辑源码文件',
  description: '按路径和行号分页读取一个 JSON 源码、素材或证据文件。',
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
    path: z.string().min(1),
    startLine: z.number().int().min(1).optional(),
    lineCount: z.number().int().min(1).max(400).optional(),
  }),
  summarize: ({ path }) => `读取 ${path}`,
  execute: ({ path, startLine = 1, lineCount = 200 }) => {
    const file = getTimelineCodingSession().workspace.read(path)
    const lines = file.content.split('\n')
    const startIndex = Math.min(startLine - 1, lines.length)
    const endIndex = Math.min(startIndex + lineCount, lines.length)
    return {
      ok: true,
      message: `已读取 ${path}。`,
      data: {
        path: file.path,
        kind: file.kind,
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

const searchFiles = defineAiEditingTool({
  id: 'workspace.search',
  title: '搜索剪辑源码',
  description: '在源码、素材索引和内容证据中搜索文字，返回带文件与行号的有界结果。',
  risk: 'read',
  inputSchema: objectSchema(
    {
      query: { type: 'string' },
      path: { type: 'string' },
      caseSensitive: { type: 'boolean' },
      cursor: { type: 'integer', minimum: 0, maximum: 10_000 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
    ['query'],
  ),
  schema: z.strictObject({
    query: z.string().min(1),
    path: z.string().optional(),
    caseSensitive: z.boolean().optional(),
    cursor: z.number().int().min(0).max(10_000).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  summarize: ({ query }) => `搜索“${query}”`,
  execute: (args) => ({
    ok: true,
    message: '搜索完成。',
    data: getTimelineCodingSession().workspace.search(args),
  }),
})

const gitStatus = defineAiEditingTool({
  id: 'git.status',
  title: '查看源码仓库状态',
  description: '查看内部剪辑源码仓库的当前分支、HEAD 和未提交文件。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '查看源码仓库状态',
  execute: async () => ({
    ok: true,
    message: '已读取源码仓库状态。',
    data: await getTimelineCodingSession().repository.status(),
  }),
})

const gitDiff = defineAiEditingTool({
  id: 'git.diff',
  title: '查看源码差异',
  description: '查看当前工作树相对 Git HEAD 的源码文件差异。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '查看源码差异',
  execute: async () => ({
    ok: true,
    message: '已生成源码差异。',
    data: await getTimelineCodingSession().repository.diff(),
  }),
})

const gitLog = defineAiEditingTool({
  id: 'git.log',
  title: '查看源码历史',
  description: '读取当前剪辑源码分支的有界提交历史。',
  risk: 'read',
  inputSchema: objectSchema({ limit: { type: 'integer', minimum: 1, maximum: 200 } }),
  schema: z.strictObject({ limit: z.number().int().min(1).max(200).optional() }),
  summarize: () => '查看源码历史',
  execute: async ({ limit }) => ({
    ok: true,
    message: '已读取源码历史。',
    data: await getTimelineCodingSession().repository.log(limit),
  }),
})

const gitBranch = defineAiEditingTool({
  id: 'git.branch',
  title: '管理源码分支',
  description: '列出内部剪辑源码分支，或从当前版本创建一个分支。',
  risk: 'edit',
  inputSchema: objectSchema({
    name: { type: 'string', minLength: 1, maxLength: 120 },
  }),
  schema: z.strictObject({
    name: z.string().trim().min(1).max(120).optional(),
  }),
  summarize: ({ name }) => (name ? `创建源码分支 ${name}` : '列出源码分支'),
  execute: async ({ name }) => {
    const repository = getTimelineCodingSession().repository
    const data =
      typeof name === 'string' ? await repository.createBranch(name) : await repository.branches()
    return {
      ok: true,
      message: typeof name === 'string' ? '源码分支已创建。' : '已列出源码分支。',
      data,
    }
  },
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
    listFiles,
    readFile,
    searchFiles,
    gitStatus,
    gitDiff,
    gitLog,
    gitBranch,
    gitCommit,
    checkTimeline,
  ],
}
