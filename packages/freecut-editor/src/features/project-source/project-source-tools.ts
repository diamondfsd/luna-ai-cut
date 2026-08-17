import { useProjectStore } from '@freecut/features/editor/deps/projects'
import { MEDIA_AI_TOOLS } from './project-source-media-tools'
import { TIMELINE_AI_TOOLS } from './project-source-ai-tools'
export interface ProjectEditingJsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface ProjectEditingToolResult {
  ok: boolean
  message: string
  data?: unknown
}

export type ProjectEditingValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export interface ProjectEditingTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: ProjectEditingJsonSchema
  validate(args: unknown): ProjectEditingValidation
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ProjectEditingToolResult>
}

function currentProjectId(): string {
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前没有打开的项目。')
  return projectId
}

export const EDITING_TOOLS: readonly ProjectEditingTool[] = [
  ...MEDIA_AI_TOOLS,
  ...TIMELINE_AI_TOOLS,
]

/** Renderer-side capability adapter used by the DeepSeek Harness plugin. */
export async function executeEditingTool(
  name: string,
  args: Record<string, unknown>,
  expectedProjectId?: string,
  signal?: AbortSignal,
): Promise<ProjectEditingToolResult> {
  signal?.throwIfAborted()
  const activeProjectId = currentProjectId()
  if (expectedProjectId !== undefined && expectedProjectId !== activeProjectId) {
    throw new Error('项目已经切换，请重新打开 AI 助手后再继续。')
  }
  const tool = EDITING_TOOLS.find((entry) => entry.name === name)
  if (!tool) throw new Error(`未知的剪辑能力：${name}`)
  const validation = tool.validate(args)
  if (!validation.ok) throw new Error(validation.error)
  return tool.execute(validation.value, signal)
}
