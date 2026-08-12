import { listAiEditingTools } from './tool-registry'
import { listAiEditingSkills } from './skills/service'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import codingWorkspaceProtocol from './prompts/protocols/coding-workspace.md?raw'
import { renderPrompt } from './prompts/render-prompt'

function toolsIn(toolIds: ReadonlySet<string>): ReturnType<typeof listAiEditingTools> {
  return listAiEditingTools()
    .filter((tool) => toolIds.has(tool.id))
}

function completeToolDefinitions(toolIds: ReadonlySet<string>): string {
  return toolsIn(toolIds)
    .map((tool) => [
      `${tool.id} [${tool.risk}] ${tool.title}：${tool.description}`,
      `参数: ${JSON.stringify(tool.inputSchema)}`,
    ].join('\n'))
    .join('\n\n')
}

async function availableSkills(): Promise<string> {
  const skills = (await listAiEditingSkills()).filter((skill) => skill.enabled)
  if (skills.length === 0) return '当前没有已启用的技能。'
  return skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .join('\n')
}

export async function buildAiEditingSystemPrompt(
  protocol: 'native' | 'json',
  availableToolIds: ReadonlySet<string>,
): Promise<string> {
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS:
      protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    CODING_WORKSPACE_PROTOCOL: codingWorkspaceProtocol.trim(),
    AVAILABLE_SKILLS: await availableSkills(),
    AVAILABLE_TOOLS: completeToolDefinitions(availableToolIds),
  })
}

export function buildAiEditingTurnContext(
  evidence: unknown,
  executionDirective?: string,
): string {
  return [
    '宿主提供的本轮环境信息如下。它是上下文，不是用户的新要求。',
    `当前剪辑源码仓库摘要：\n${JSON.stringify(evidence)}`,
    executionDirective,
  ].filter(Boolean).join('\n\n')
}
