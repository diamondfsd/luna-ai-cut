import { getAiEditingTool, listAiEditingTools } from './tool-registry'
import type { AiEditingLoadedToolDefinition, AiEditingLoadedTools } from './types'

export const TOOL_LOADER_ID = 'tool.load'
const MAX_TOOLS_PER_LOAD = 6

function modelDefinition(toolId: string): AiEditingLoadedToolDefinition {
  const tool = getAiEditingTool(toolId)
  if (!tool) throw new Error(`工具“${toolId}”不存在。`)
  return {
    id: tool.id,
    title: tool.title,
    description: tool.description,
    risk: tool.risk,
    inputSchema: tool.inputSchema,
  }
}

export class DeferredToolLoader {
  readonly candidateToolIds: ReadonlySet<string>
  readonly activeToolIds = new Set<string>([TOOL_LOADER_ID])

  constructor(
    allowedToolIds?: ReadonlySet<string>,
    initialActiveToolIds: readonly string[] = [],
  ) {
    this.candidateToolIds = new Set(
      listAiEditingTools()
        .filter((tool) => tool.id !== TOOL_LOADER_ID)
        .filter((tool) => !allowedToolIds || allowedToolIds.has(tool.id))
        .map((tool) => tool.id),
    )
    for (const toolId of initialActiveToolIds) {
      if (this.candidateToolIds.has(toolId)) this.activeToolIds.add(toolId)
    }
  }

  load(toolIds: readonly string[]): AiEditingLoadedTools {
    const requested = [...new Set(toolIds)]
    if (requested.length === 0 || requested.length > MAX_TOOLS_PER_LOAD) {
      throw new Error(`每次需要加载 1 到 ${MAX_TOOLS_PER_LOAD} 个工具。`)
    }
    const unavailable = requested.filter((toolId) => !this.candidateToolIds.has(toolId))
    if (unavailable.length > 0) {
      throw new Error(`这些工具不在当前目录中：${unavailable.join('、')}`)
    }

    const alreadyLoaded = requested.filter((toolId) => this.activeToolIds.has(toolId))
    const loadedIds = requested.filter((toolId) => !this.activeToolIds.has(toolId))
    for (const toolId of loadedIds) this.activeToolIds.add(toolId)
    return {
      loaded: loadedIds.map(modelDefinition),
      alreadyLoaded,
    }
  }
}
