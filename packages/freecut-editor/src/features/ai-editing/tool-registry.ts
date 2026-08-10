import type { AiEditingTool, AiEditingToolModule, AiEditingToolRegistryContext } from './types'

type ToolModuleImport = { aiEditingToolModule?: AiEditingToolModule }

const AGENT_TOOL_IDS = new Set([
  'workflow.set_plan',
  'workflow.finish',
  'skill.search',
  'skill.read',
  'html.validate',
  'html.read',
  'workspace.apply_edit_program',
  'analysis.request',
  'analysis.search_transcript',
  'audio.analyze_beats',
])

// Vite expands this at build time. Adding a `*-tools.ts` file with the module
// export below automatically makes its tools available to the editor agent.
const importedModules = import.meta.glob<ToolModuleImport>('./tools/*-tools.ts', { eager: true })

let registeredTools: readonly AiEditingTool[] = []

const registryContext: AiEditingToolRegistryContext = {
  listTools: () => registeredTools,
}

function loadToolModules(): AiEditingToolModule[] {
  return Object.entries(importedModules)
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([path, toolModuleImport]) => {
      if (!toolModuleImport.aiEditingToolModule) {
        throw new Error(`剪辑助手工具模块“${path}”未导出 aiEditingToolModule。`)
      }
      return toolModuleImport.aiEditingToolModule
    })
}

function registerTools(): Map<string, AiEditingTool> {
  const toolsById = new Map<string, AiEditingTool>()
  const collectedTools = loadToolModules()
    .flatMap((module) => module.createTools(registryContext))
    .filter((tool) => AGENT_TOOL_IDS.has(tool.id))

  for (const tool of collectedTools) {
    if (toolsById.has(tool.id)) throw new Error(`剪辑助手工具 ID 重复：“${tool.id}”。`)
    toolsById.set(tool.id, tool)
  }

  registeredTools = Object.freeze(collectedTools)
  return toolsById
}

const toolsById = registerTools()

export function listAiEditingTools(): readonly AiEditingTool[] {
  return registeredTools
}

export function getAiEditingTool(id: string): AiEditingTool | undefined {
  return toolsById.get(id)
}
