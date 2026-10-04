import { directorEditToolModule } from '../features/ai-editor/directorEditToolModule.ts'
import { createAgentSkillModule } from '../features/agent-skills/agentSkillModule.ts'
import { agentWorkflowModule } from '../features/agent-workflows/agentWorkflowModule.ts'
import { LUNA_HTTP_SKILL } from './lunaHttpSkill.ts'
import { DIRECTOR_PLAN_HTTP_SKILL } from './directorPlanHttpSkill.ts'
import { executeEditorTool, editorToolPolicy } from './lunaEditorToolModule.ts'
import { AGENT_TASK_TOOLS } from './lunaMcpTaskCatalog.ts'
import { DIRECTOR_PLAN_TOOLS, handleDirectorPlanTool } from './directorPlanTools.ts'
import { handleAgentTaskTool } from './lunaMcpTaskTools.ts'
import { createToolRegistry, type LunaToolModule } from './lunaToolModule.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

const musicNames = new Set(['list_music_templates', 'get_music_template', 'generate_background_music'])

export function appToolRegistry(options: LunaMcpServerOptions) {
  const modules: LunaToolModule[] = [
    agentWorkflowModule,
    directorEditToolModule,
    createAgentSkillModule(context => appToolRegistry(context).skills),
    { id: 'editing-guide', tools: [], skills: [{ id: 'editing', purpose: 'editing',
      description: '视频剪辑、选段、字幕、音乐、包装和导出；可组合导演计划工具。进入流程后使用 list_editing_skills 发现场景 Skill，并按 description 选择。', instructions: LUNA_HTTP_SKILL }],
      execute: async () => null },
    { id: 'agent-tasks', tools: AGENT_TASK_TOOLS.filter(tool => !musicNames.has(tool.name)), execute: handleAgentTaskTool },
    { id: 'music', tools: AGENT_TASK_TOOLS.filter(tool => musicNames.has(tool.name)), allowedPurposes: ['editing'], execute: handleAgentTaskTool },
  ]
  if (options.directorPlanTools) modules.push({
    id: 'director-plans', tools: DIRECTOR_PLAN_TOOLS,
    skills: [{ id: 'director-plan', purpose: 'director-plan', description: '创建、读取和编辑拍摄或导演计划。只生成方案，不创建剪辑项目或成片。', instructions: DIRECTOR_PLAN_HTTP_SKILL }],
    execute: (name, args, context, callId) => handleDirectorPlanTool(name, args, callId, context.directorPlanTools, context.agentSession),
  })
  return {
    ...createToolRegistry([...modules, ...(options.toolModules ?? [])]),
    // Legacy dynamic renderer tools belong to the editing domain, not the transport.
    fallback: { ...editorToolPolicy, execute: executeEditorTool },
  }
}
