import type { LunaAgentSkill } from '../../mcp/lunaToolModule.ts'
import { AGENT_SKILL_DISCOVERY_GUIDANCE } from '../agent-workflows/agentTaskGuidance.ts'

/** Compatibility Markdown endpoint; primary discovery is list_agent_skills/get_agent_skill. */
export function agentSkillIndex(skills: readonly LunaAgentSkill[]): string {
  return `# Luna AI Cut 技能索引

请通过 list_agent_skills 获取实时技能清单，通过 get_agent_skill 读取全文。GET /tools 查看工具 schema。

${skills.map(skill => `- **${skill.id}**：${skill.description}${skill.purpose ? `；workflow=${skill.purpose}` : ''}`).join('\n')}

${AGENT_SKILL_DISCOVERY_GUIDANCE}
`
}
