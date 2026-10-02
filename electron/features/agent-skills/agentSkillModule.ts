import type { LunaAgentSkill, LunaToolModule } from '../../mcp/lunaToolModule.ts'
import type { LunaMcpServerOptions } from '../../mcp/lunaMcpProtocol.ts'
import { AGENT_SKILL_DISCOVERY_GUIDANCE } from '../agent-workflows/agentTaskGuidance.ts'

type RegisteredSkill = LunaAgentSkill & { moduleId: string }
type SkillResolver = (context: LunaMcpServerOptions) => readonly RegisteredSkill[]

/** Read-only discovery works before the editor, a session or a workflow exists. */
export function createAgentSkillModule(resolveSkills: SkillResolver): LunaToolModule {
  return {
    id: 'agent-skills',
    tools: [{
      name: 'list_agent_skills',
      description: 'Discover all registered Luna app skills without opening the editor or claiming a task. Returns descriptions, owning modules, workflows and common task guidance; not full skill instructions. Choose skills from user intent, not guessed names. Optional query matches metadata; omit it to browse all skills.',
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { query: { type: 'string', maxLength: 256 }, moduleId: { type: 'string', minLength: 1 }, workflow: { type: 'string', minLength: 1 } },
      },
    }, {
      name: 'get_agent_skill',
      description: 'Read a skill by the exact skillId returned by list_agent_skills. Returns its current full instructions and workflow. Read before operating; follow any nested discovery tools declared by that skill. Does not open the editor or grant write permission.',
      inputSchema: { type: 'object', additionalProperties: false,
        properties: { skillId: { type: 'string', minLength: 1 } }, required: ['skillId'],
      },
    }],
    async execute(name, args, context) {
      if (name !== 'list_agent_skills' && name !== 'get_agent_skill') return null
      const allowed = name === 'list_agent_skills' ? ['query', 'moduleId', 'workflow'] : ['skillId']
      if (Object.keys(args).some(key => !allowed.includes(key)) || Object.values(args).some(value => typeof value !== 'string')
        || (name === 'get_agent_skill' && (typeof args.skillId !== 'string' || !args.skillId.trim()))
        || (typeof args.query === 'string' && args.query.length > 256)
        || ['moduleId', 'workflow'].some(key => key in args && !(args[key] as string).trim())) {
        return { ok: true, result: { ok: false, error: { code: 'INVALID_PARAMS', message: '技能查询参数无效', retryable: false } } }
      }
      const skills = resolveSkills(context)
      const metadata = (skill: RegisteredSkill) => ({ skillId: skill.id, moduleId: skill.moduleId,
        description: skill.description, ...(skill.purpose ? { workflow: skill.purpose } : {}) })
      if (name === 'get_agent_skill') {
        const skill = skills.find(item => item.id === args.skillId)
        if (!skill) return { ok: true, result: { ok: false, error: { code: 'SKILL_NOT_FOUND', message: '技能不存在', retryable: false,
          suggestedAction: 'Call list_agent_skills and use a returned skillId; do not guess IDs or paths.' } } }
        return { ok: true, result: { ok: true, data: { ...metadata(skill), instructions: skill.instructions } } }
      }
      const query = typeof args.query === 'string' ? args.query.trim().toLocaleLowerCase() : ''
      const matches = skills.filter(skill => (!args.moduleId || skill.moduleId === args.moduleId)
        && (!args.workflow || skill.purpose === args.workflow)
        && (!query || `${skill.id} ${skill.moduleId} ${skill.description}`.toLocaleLowerCase().includes(query)))
      return { ok: true, result: { ok: true, data: { skills: matches.map(metadata), guidance: AGENT_SKILL_DISCOVERY_GUIDANCE } } }
    },
  }
}
