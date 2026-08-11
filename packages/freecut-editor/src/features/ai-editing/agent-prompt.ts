import { listAiEditingTools } from './tool-registry'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import codingWorkspaceProtocol from './prompts/protocols/coding-workspace.md?raw'
import { renderPrompt } from './prompts/render-prompt'

function toolCatalog(
  availableToolIds: ReadonlySet<string> | undefined,
  includeParameters: boolean,
): string {
  return listAiEditingTools()
    .filter((tool) => !availableToolIds || availableToolIds.has(tool.id))
    .map((tool) =>
      [
        `${tool.id} [${tool.risk}] ${tool.description}`,
        ...(includeParameters ? [`参数: ${JSON.stringify(tool.inputSchema)}`] : []),
      ].join('\n'),
    )
    .join('\n')
}

export async function buildAiEditingSystemPrompt(
  evidence: unknown,
  protocol: 'native' | 'json',
  _userText = '',
  availableToolIds?: ReadonlySet<string>,
): Promise<string> {
  const availableTools = `本轮可用工具清单：\n${toolCatalog(availableToolIds, protocol === 'json')}`
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS:
      protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    CODING_WORKSPACE_PROTOCOL: codingWorkspaceProtocol.trim(),
    AVAILABLE_TOOLS: availableTools,
    REPOSITORY_CONTEXT: JSON.stringify(evidence),
  })
}
