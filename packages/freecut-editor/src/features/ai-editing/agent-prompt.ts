import { listAiEditingTools } from './tool-registry'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import editProgramProtocol from './prompts/protocols/edit-program.md?raw'
import uiCloseupsExample from './prompts/examples/ui-closeups.md?raw'
import { renderPrompt } from './prompts/render-prompt'

function toolCatalog(): string {
  return listAiEditingTools()
    .map((tool) => `${tool.id} [${tool.risk}] ${tool.description}\n参数: ${JSON.stringify(tool.inputSchema)}`)
    .join('\n')
}

export function buildAiEditingSystemPrompt(evidence: unknown, protocol: 'native' | 'json'): string {
  const availableTools = `完整工具清单：\n${toolCatalog()}`
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS: protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    EDIT_PROGRAM_PROTOCOL: editProgramProtocol.trim(),
    EDIT_PROGRAM_EXAMPLES: uiCloseupsExample.trim(),
    AVAILABLE_TOOLS: availableTools,
    PROJECT_EVIDENCE: JSON.stringify(evidence),
  })
}
