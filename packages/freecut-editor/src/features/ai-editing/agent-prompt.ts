import { listAiEditingTools } from './tool-registry'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import editProgramProtocol from './prompts/protocols/edit-program.md?raw'
import uiCloseupsExample from './prompts/examples/ui-closeups.md?raw'
import creativeDecisionSkill from './prompts/skills/foundations/creative-decision.md?raw'
import directingAndEditingSkill from './prompts/skills/foundations/directing-and-editing.md?raw'
import reviewAndRefinementSkill from './prompts/skills/foundations/review-and-refinement.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { listAiEditingSkills, searchAiEditingSkills } from './skills/service'

function toolCatalog(): string {
  return listAiEditingTools()
    .map((tool) => `${tool.id} [${tool.risk}] ${tool.description}\n参数: ${JSON.stringify(tool.inputSchema)}`)
    .join('\n')
}

async function specialistSkillsFor(userText: string): Promise<string> {
  const matches = searchAiEditingSkills(userText, await listAiEditingSkills()).slice(0, 2)
  if (matches.length === 0) return '本轮没有需要额外加载的专项技能。依据常驻专业能力自主完成。'
  return matches
    .map((skill) => `### ${skill.name}\n\n${skill.instructions}`)
    .join('\n\n')
}

export async function buildAiEditingSystemPrompt(
  evidence: unknown,
  protocol: 'native' | 'json',
  userText = '',
): Promise<string> {
  const availableTools = `完整工具清单：\n${toolCatalog()}`
  const professionalCreationSkills = [
    creativeDecisionSkill,
    directingAndEditingSkill,
    reviewAndRefinementSkill,
  ].map((skill) => skill.trim()).join('\n\n')
  return renderPrompt(agentSystemPrompt, {
    PROFESSIONAL_CREATION_SKILLS: professionalCreationSkills,
    SPECIALIST_SKILLS: await specialistSkillsFor(userText),
    PROTOCOL_INSTRUCTIONS: protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    EDIT_PROGRAM_PROTOCOL: editProgramProtocol.trim(),
    EDIT_PROGRAM_EXAMPLES: uiCloseupsExample.trim(),
    AVAILABLE_TOOLS: availableTools,
    PROJECT_EVIDENCE: JSON.stringify(evidence),
  })
}
