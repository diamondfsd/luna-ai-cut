import { executeEditorTool, editorToolPolicy } from './lunaEditorToolModule.ts'
import { AGENT_TASK_TOOLS } from './lunaMcpTaskCatalog.ts'
import { DIRECTOR_PLAN_TOOLS, handleDirectorPlanTool } from './directorPlanTools.ts'
import { handleAgentTaskTool } from './lunaMcpTaskTools.ts'
import { createToolRegistry, type LunaToolModule } from './lunaToolModule.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

const musicNames = new Set(['list_music_templates', 'get_music_template', 'generate_background_music'])

export function appToolRegistry(options: LunaMcpServerOptions) {
  const modules: LunaToolModule[] = [
    { id: 'agent-tasks', tools: AGENT_TASK_TOOLS.filter(tool => !musicNames.has(tool.name)), execute: handleAgentTaskTool },
    { id: 'music', tools: AGENT_TASK_TOOLS.filter(tool => musicNames.has(tool.name)), allowedPurposes: ['editing'], execute: handleAgentTaskTool },
  ]
  if (options.directorPlanTools) modules.push({
    id: 'director-plans', tools: DIRECTOR_PLAN_TOOLS,
    execute: (name, args, context, callId) => handleDirectorPlanTool(name, args, callId, context.directorPlanTools, context.agentSession),
  })
  return {
    ...createToolRegistry([...modules, ...(options.toolModules ?? [])]),
    // Legacy dynamic renderer tools belong to the editing domain, not the transport.
    fallback: { ...editorToolPolicy, execute: executeEditorTool },
  }
}
