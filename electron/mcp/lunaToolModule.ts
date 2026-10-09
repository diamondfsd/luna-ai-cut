import type { AiEditorMcpResponse } from '../../src/shared/types/aiEditor.ts'
import type { AgentTaskPurpose } from '../../src/shared/types/aiEditor.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

export interface LunaToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
export interface LunaAgentSkill {
  id: string
  description: string
  purpose?: Exclude<AgentTaskPurpose, 'auto'>
  instructions: string
}
/** Domains own schemas, execution and task policies; transports never enumerate domain names. */
export interface LunaToolModule {
  id: string
  tools: readonly LunaToolDefinition[]
  skills?: readonly LunaAgentSkill[]
  allowedPurposes?: readonly string[]
  execute(name: string, args: Record<string, unknown>, context: LunaMcpServerOptions, callId: string): Promise<AiEditorMcpResponse | null>
}

export function createToolRegistry(modules: readonly LunaToolModule[]) {
  const owners = new Map<string, LunaToolModule>()
  const skills = new Map<string, LunaAgentSkill & { moduleId: string }>()
  for (const module of modules) {
    for (const skill of module.skills ?? []) {
      if (skill.id === 'index' || !/^[a-z0-9][a-z0-9-]*$/.test(skill.id)) throw new Error(`Invalid skill id: ${skill.id}`)
      if (skills.has(skill.id)) throw new Error(`Duplicate skill registration: ${skill.id}`)
      skills.set(skill.id, { ...skill, moduleId: module.id })
    }
    for (const tool of module.tools) {
      if (owners.has(tool.name)) throw new Error(`Duplicate tool registration: ${tool.name}`)
      owners.set(tool.name, module)
    }
  }
  return {
    skills: [...skills.values()],
    tools: modules.flatMap(module => module.tools.map(tool => ({ ...tool, _meta: { module: module.id } }))),
    resolve: (name: string) => owners.get(name),
  }
}
