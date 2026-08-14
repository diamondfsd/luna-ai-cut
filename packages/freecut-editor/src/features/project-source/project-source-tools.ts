import { z } from 'zod'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { readProjectSource } from '@freecut/features/project-source/project-source-worktree'
import {
  acquireAiEditingSourceWriteOwnership,
} from '@freecut/features/project-source/project-source-write-ownership'
export interface ProjectSourceJsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ProjectSourceToolResult {
  ok: boolean
  message: string
  data?: unknown
}

export type ProjectSourceValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export interface ProjectSourceTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: ProjectSourceJsonSchema
  validate(args: unknown): ProjectSourceValidation
  execute(args: Record<string, unknown>): Promise<ProjectSourceToolResult>
}

const MAX_FILES = 500
const MAX_READ_BYTES = 48_000
const MAX_SEARCH_RESULTS = 100
const MAX_DIFF_BYTES = 8_000

function isEditableSourcePath(path: string): boolean {
  return path === 'manifest.json' ||
    (path.endsWith('.json') && (path.startsWith('sequences/') || path.startsWith('components/')))
}

function isReadableSourcePath(path: string): boolean {
  return path === 'AGENTS.md' || isEditableSourcePath(path)
}

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的项目。')
  return projectId
}

function bridge() {
  const value = getEmbeddedHostBridge().editingSourceGit
  if (!value) throw new Error('当前运行环境不支持工程源码编辑。')
  return value
}

function schema(properties: Record<string, unknown>, required: string[] = []): ProjectSourceJsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

function boundedDiffContent(content: string | null): string | null {
  if (content === null || content.length <= MAX_DIFF_BYTES) return content
  return `${content.slice(0, MAX_DIFF_BYTES)}\n...[内容已截断]`
}

function validate<S extends z.ZodType>(input: unknown, value: S): ProjectSourceValidation {
  const result = value.safeParse(input ?? {})
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
  const issue = result.error.issues[0]
  return { ok: false, error: `${issue?.path.join('.') || 'args'}: ${issue?.message || '无效参数'}` }
}

function tool<S extends z.ZodType>(input: {
  name: string
  description: string
  inputSchema: ProjectSourceJsonSchema
  schema: S
  execute: (args: z.infer<S>) => Promise<ProjectSourceToolResult>
}): ProjectSourceTool {
  return {
    name: input.name,
    description: input.description,
    inputSchema: input.inputSchema,
    validate: (args) => validate(args, input.schema),
    execute: (args) => input.execute(args as z.infer<S>),
  }
}

async function allFiles(sourceDirectory = ''): Promise<string[]> {
  const source = bridge()
  const pending = [sourceDirectory]
  const files: string[] = []
  while (pending.length > 0) {
    const directory = pending.shift()!
    for (const entry of await source.list(currentProjectId(), directory)) {
      if (entry.type === 'directory') pending.push(entry.path)
      else if (isReadableSourcePath(entry.path)) files.push(entry.path)
      if (files.length > MAX_FILES) throw new Error('工程源码文件过多，请缩小读取范围。')
    }
  }
  return files.sort()
}

const sourceTree = tool({
  name: 'source.tree',
  description: '列出工程源码文件。AGENTS.md 是工作区说明；JSON 文件包含 manifest、序列、轨道和片段数据。',
  inputSchema: schema({ prefix: { type: 'string', description: '可选的目录前缀。' } }),
  schema: z.object({ prefix: z.string().optional() }),
  execute: async (args) => {
    const files = await allFiles(args.prefix)
    return { ok: true, message: `找到 ${files.length} 个源码文件。`, data: { files } }
  },
})

const sourceRead = tool({
  name: 'source.read',
  description: '读取指定源码文件。返回带行号的内容；不要一次读取整个工程。',
  inputSchema: schema({ path: { type: 'string' }, startLine: { type: 'integer', minimum: 1 }, endLine: { type: 'integer', minimum: 1 } }, ['path']),
  schema: z.object({ path: z.string().min(1), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional() }),
  execute: async (args) => {
    if (!isReadableSourcePath(args.path)) throw new Error('只能读取工程源码 JSON 文件或根目录 AGENTS.md。')
    const content = await bridge().read(currentProjectId(), args.path)
    const lines = content.split('\n')
    const start = (args.startLine ?? 1) - 1
    const end = Math.min(args.endLine ?? start + 200, lines.length, start + 400)
    const selected = lines.slice(Math.max(0, start), end)
    const text = selected.map((line, index) => `${Math.max(0, start) + index + 1}: ${line}`).join('\n')
    if (text.length > MAX_READ_BYTES) throw new Error('源码读取结果过大，请缩小行范围。')
    return { ok: true, message: `已读取 ${args.path} 的 ${selected.length} 行。`, data: { path: args.path, startLine: start + 1, endLine: end, content: text } }
  },
})

const sourceSearch = tool({
  name: 'source.search',
  description: '在工程源码和 AGENTS.md 中搜索文本，返回文件路径和行号。',
  inputSchema: schema({ query: { type: 'string' }, prefix: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_RESULTS } }, ['query']),
  schema: z.object({ query: z.string().min(1), prefix: z.string().optional(), limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional() }),
  execute: async (args) => {
    const results: Array<{ path: string; line: number; text: string }> = []
    for (const path of await allFiles(args.prefix)) {
      const content = await bridge().read(currentProjectId(), path)
      content.split('\n').forEach((line, index) => {
        if (results.length < (args.limit ?? 50) && line.toLocaleLowerCase().includes(args.query.toLocaleLowerCase())) {
          results.push({ path, line: index + 1, text: line.trim().slice(0, 240) })
        }
      })
      if (results.length >= (args.limit ?? 50)) break
    }
    return { ok: true, message: `找到 ${results.length} 处匹配。`, data: results }
  },
})

const sourceApplyChanges = tool({
  name: 'source.apply_changes',
  description: '按 expectedContent 原子修改工程源码，并校验源码可以重新编译成时间轴。修改成功后重新加载编辑器。',
  inputSchema: schema({
    changes: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { type: 'object', properties: { path: { type: 'string' }, content: { type: ['string', 'null'] }, expectedContent: { type: ['string', 'null'] } }, required: ['path', 'content', 'expectedContent'], additionalProperties: false },
    },
  }, ['changes']),
  schema: z.object({ changes: z.array(z.object({ path: z.string().min(1), content: z.string().nullable(), expectedContent: z.string().nullable() })).min(1).max(20) }),
  execute: async (args) => {
    for (const change of args.changes) {
      if (!isEditableSourcePath(change.path)) {
        throw new Error(`不允许修改 ${change.path}，只能修改 manifest、sequences 和 components 下的 JSON 源码。`)
      }
    }
    const projectId = currentProjectId()
    const source = bridge()
    const release = acquireAiEditingSourceWriteOwnership()
    try {
      await source.applyChanges(projectId, args.changes)
      try {
        const compiled = await readProjectSource(projectId)
        if (!compiled?.timeline) throw new Error('源码没有生成有效的时间轴。')
      } catch (error) {
        const rollback = args.changes.map((change) => ({ path: change.path, content: change.expectedContent, expectedContent: change.content }))
        await source.applyChanges(projectId, rollback)
        throw error
      }
      await useTimelineStore.getState().loadTimeline(projectId)
      return { ok: true, message: `已应用 ${args.changes.length} 个源码文件的修改，并重新加载时间轴。`, data: { paths: args.changes.map((change) => change.path) } }
    } finally {
      release()
    }
  },
})

const sourceCheck = tool({
  name: 'source.check',
  description: '解析并校验当前工程源码，确认引用关系和时间轴结构完整。',
  inputSchema: schema({}),
  schema: z.object({}),
  execute: async () => {
    const project = await readProjectSource(currentProjectId())
    if (!project?.timeline) throw new Error('工程源码未生成有效的时间轴。')
    return { ok: true, message: `源码校验通过：${project.timeline.items.length} 个片段，${project.timeline.tracks.length} 条轨道。`, data: { itemCount: project.timeline.items.length, trackCount: project.timeline.tracks.length } }
  },
})

const sourceDiff = tool({
  name: 'source.diff',
  description: '查看当前源码工作树的文件级修改，供应用前审核。',
  inputSchema: schema({}),
  schema: z.object({}),
  execute: async () => {
    const changes = await bridge().diff(currentProjectId())
    return {
      ok: true,
      message: `当前有 ${changes.length} 个源码文件发生变化。`,
      data: changes.map(({ path, change, before, after }) => ({
        path,
        change,
        before: boundedDiffContent(before),
        after: boundedDiffContent(after),
      })),
    }
  },
})

export const PROJECT_SOURCE_TOOLS: readonly ProjectSourceTool[] = [sourceTree, sourceRead, sourceSearch, sourceApplyChanges, sourceCheck, sourceDiff]

/** Renderer-side capability adapter used by the DeepSeek Harness plugin. */
export async function executeProjectSourceTool(
  name: string,
  args: Record<string, unknown>,
  expectedProjectId?: string,
): Promise<ProjectSourceToolResult> {
  const activeProjectId = currentProjectId()
  if (expectedProjectId !== undefined && expectedProjectId !== activeProjectId) {
    throw new Error('项目已经切换，请重新打开 AI 助手后再继续。')
  }
  const tool = PROJECT_SOURCE_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`未知的工程源码能力：${name}`)
  const validation = tool.validate(args)
  if (!validation.ok) throw new Error(validation.error)
  return tool.execute(validation.value)
}
