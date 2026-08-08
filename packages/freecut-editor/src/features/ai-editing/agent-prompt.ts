import { listAiEditingToolCatalog } from './tool-discovery'
import { listAiEditingTools } from './tool-registry'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import { renderPrompt } from './prompts/render-prompt'

function toolCatalog(): string {
  return listAiEditingTools()
    .map((tool) => `${tool.id} [${tool.risk}] ${tool.description}\n参数: ${JSON.stringify(tool.inputSchema)}`)
    .join('\n')
}

function toolNameCatalog(): string {
  return listAiEditingToolCatalog(listAiEditingTools())
    .map((tool) => `${tool.id} | ${tool.title}`)
    .join('\n')
}

export function buildAiEditingSystemPrompt(evidence: unknown, protocol: 'native' | 'json'): string {
  const availableTools = protocol === 'native'
    ? `剪辑能力目录（ID 与名称）：\n${toolNameCatalog()}`
    : `可用工具：\n${toolCatalog()}`
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS: protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    AVAILABLE_TOOLS: availableTools,
    PROJECT_EVIDENCE: JSON.stringify(evidence),
  })
}
