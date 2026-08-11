import { z } from 'zod'
import { isEditingSourceFile } from '../coding-workspace/durable-source-repository'
import type { AiEditingToolModule } from '../types'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import { defineAiEditingTool, objectSchema } from './tool-utils'

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
        ...file,
        content: lines.slice(startIndex, endIndex).join('\n'),
        startLine: startIndex + 1,
        endLine: endIndex,
        totalLines: lines.length,
        ...(endIndex < lines.length ? { nextLine: endIndex + 1 } : {}),
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

const patchOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('write'),
    path: z.string(),
    content: z.string(),
    expectedContent: z.string().optional(),
  }),
  z.strictObject({
    op: z.literal('replace'),
    path: z.string(),
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal('delete'),
    path: z.string(),
    expectedContent: z.string().optional(),
  }),
])
const patchSchema = z
  .strictObject({
    expectedRevision: z.number().int().min(0).optional(),
    operations: z.array(patchOperationSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    value.operations.forEach((operation, index) => {
      if (!isEditingSourceFile(operation.path)) {
        context.addIssue({
          code: 'custom',
          path: ['operations', index, 'path'],
          message: '这个路径是只读项目投影。',
        })
      }
    })
  })
const patchJsonSchema = z.toJSONSchema(patchSchema)

const patchFiles = defineAiEditingTool({
  id: 'workspace.patch',
  title: '修改剪辑源码',
  description: '原子创建、替换或删除源码文件；不能修改素材与当前时间轴证据。',
  risk: 'edit',
  execution: 'async',
  inputSchema: {
    type: 'object',
    properties: patchJsonSchema.properties ?? {},
    required: patchJsonSchema.required,
    additionalProperties: false,
  },
  schema: patchSchema,
  summarize: ({ operations }) => `修改 ${operations.length} 处剪辑源码`,
  execute: async (args) => ({
    ok: true,
    message: '剪辑源码已修改并保存。',
    data: await getTimelineCodingSession().applyPatch(args),
  }),
})

const workspaceStatus = defineAiEditingTool({
  id: 'workspace.status',
  title: '查看源码状态',
  description: '查看当前分支、checkout revision 和未提交源码文件。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '查看剪辑源码状态',
  execute: async () => {
    const session = getTimelineCodingSession()
    return {
      ok: true,
      message: '已读取源码状态。',
      data: {
        workspace: session.workspace.status(),
        git: await session.repository.status(),
      },
    }
  },
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
  description: '把模块化剪辑源码提交到内部 Git 历史；不会修改真实时间轴。',
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

const timelineCommand = (id: 'timeline.check' | 'timeline.build' | 'timeline.diff') =>
  defineAiEditingTool({
    id,
    title:
      id === 'timeline.check'
        ? '检查剪辑源码'
        : id === 'timeline.build'
          ? '构建剪辑工程'
          : '查看时间轴差异',
    description:
      id === 'timeline.check'
        ? '解析模块、引用和组件并进行类型检查，不修改真实时间轴。'
        : id === 'timeline.build'
          ? '把完整源码编译成时间轴程序，不修改真实时间轴。'
          : '查看构建产物将影响的操作类型和时间范围。',
    risk: 'read',
    execution: 'async',
    inputSchema: objectSchema({}),
    schema: z.strictObject({}),
    summarize: () => id,
    execute: async () => {
      const session = getTimelineCodingSession()
      const result =
        id === 'timeline.check'
          ? await session.check()
          : id === 'timeline.build'
            ? await session.build()
            : await session.diff()
      const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      return { ok, message: ok ? '命令执行通过。' : '命令发现需要修正的源码。', data: result }
    },
  })

const testTimeline = defineAiEditingTool({
  id: 'timeline.test',
  title: '验收剪辑工程',
  description: '构建完整剪辑工程，并运行 tests 目录中的有界验收规则。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '验收剪辑工程',
  execute: async () => {
    const result = await getTimelineCodingSession().test()
    return {
      ok: result.passed,
      message: result.passed ? '剪辑工程验收通过。' : '剪辑工程有未通过的验收项。',
      data: result,
    }
  },
})

const commitTimeline = defineAiEditingTool({
  id: 'timeline.commit',
  title: '发布剪辑工程',
  description: '把指定 Git 源码提交对应的构建作为一次事务发布到真实时间轴。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({ commitId: { type: 'string', minLength: 1 } }, ['commitId']),
  schema: z.strictObject({ commitId: z.string().min(1).max(200) }),
  summarize: ({ commitId }) => `发布源码版本 ${commitId.slice(0, 12)}`,
  execute: async ({ commitId }) => {
    const result = await getTimelineCodingSession().publish(commitId)
    return {
      ok: result.ok,
      message: result.ok ? '剪辑工程已发布到时间轴。' : '剪辑工程未能发布。',
      data: result,
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [
    listFiles,
    readFile,
    searchFiles,
    patchFiles,
    workspaceStatus,
    gitStatus,
    gitDiff,
    gitLog,
    gitBranch,
    gitCommit,
    timelineCommand('timeline.check'),
    timelineCommand('timeline.build'),
    testTimeline,
    timelineCommand('timeline.diff'),
    commitTimeline,
  ],
}
