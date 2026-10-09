import { aiEditingToolModule } from '../features/ai-editor/aiEditingToolModule.ts'
import { createAgentSkillModule } from '../features/agent-skills/agentSkillModule.ts'
import { agentWorkflowModule } from '../features/agent-workflows/agentWorkflowModule.ts'
import { AGENT_TASK_TOOLS } from './lunaMcpTaskCatalog.ts'
import { handleAgentTaskTool } from './lunaMcpTaskTools.ts'
import { DIRECTOR_PLAN_TOOLS, handleDirectorPlanTool } from './directorPlanTools.ts'
import { DIRECTOR_PLAN_HTTP_SKILL } from './directorPlanHttpSkill.ts'
import { createToolRegistry, type LunaToolModule } from './lunaToolModule.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

const musicToolNames = new Set(['list_music_templates', 'get_music_template', 'generate_background_music'])

export function appToolRegistry(options: LunaMcpServerOptions) {
  const modules: LunaToolModule[] = [
    agentWorkflowModule,
    aiEditingToolModule,
    createAgentSkillModule(context => appToolRegistry(context).skills),
    { id: 'agent-tasks', tools: AGENT_TASK_TOOLS.filter(tool => !musicToolNames.has(tool.name)), execute: handleAgentTaskTool },
  ]
  if (options.directorPlanTools) modules.push({
    id: 'shooting-plans', tools: DIRECTOR_PLAN_TOOLS, allowedPurposes: ['shooting'],
    skills: [{ id: 'shooting', purpose: 'shooting',
      description: '生成或修改可执行的拍摄计划。拍摄计划本身是完整交付；不要求成片、素材绑定或设备控制。',
      instructions: DIRECTOR_PLAN_HTTP_SKILL }],
    execute: (name, args, context, callId) => handleDirectorPlanTool(name, args, callId, context.directorPlanTools, context.agentSession),
  })
  return createToolRegistry([...modules, ...(options.toolModules ?? [])])
}
