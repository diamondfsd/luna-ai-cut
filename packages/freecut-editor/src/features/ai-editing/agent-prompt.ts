import { listAiEditingTools } from './tool-registry'
import agentSystemPrompt from './prompts/agent-system.md?raw'
import jsonToolsProtocol from './prompts/protocols/json-tools.md?raw'
import nativeToolsProtocol from './prompts/protocols/native-tools.md?raw'
import codingWorkspaceProtocol from './prompts/protocols/coding-workspace.md?raw'
import { renderPrompt } from './prompts/render-prompt'

function toolsIn(toolIds: ReadonlySet<string>): ReturnType<typeof listAiEditingTools> {
  return listAiEditingTools()
    .filter((tool) => toolIds.has(tool.id))
}

function compactToolCatalog(candidateToolIds: ReadonlySet<string>): string {
  return toolsIn(candidateToolIds)
    .map((tool) => `${tool.id}：${tool.title}；${tool.description}`)
    .join('\n')
}

function completeToolDefinitions(activeToolIds: ReadonlySet<string>): string {
  return toolsIn(activeToolIds)
    .map((tool) => [
      `${tool.id} [${tool.risk}] ${tool.title}：${tool.description}`,
      `参数: ${JSON.stringify(tool.inputSchema)}`,
    ].join('\n'))
    .join('\n\n')
}

export async function buildAiEditingSystemPrompt(
  evidence: unknown,
  protocol: 'native' | 'json',
  _userText = '',
  candidateToolIds: ReadonlySet<string>,
  activeToolIds: ReadonlySet<string>,
): Promise<string> {
  const availableTools = [
    '可按需加载的工具目录（这里只是能力摘要，不代表已加载）：',
    compactToolCatalog(candidateToolIds),
    protocol === 'json'
      ? `当前已加载工具的完整定义：\n${completeToolDefinitions(activeToolIds)}`
      : '当前只有 tool.load 可直接调用；其他工具先按 ID 用 tool.load 加载。',
  ].join('\n\n')
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS:
      protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    CODING_WORKSPACE_PROTOCOL: codingWorkspaceProtocol.trim(),
    AVAILABLE_TOOLS: availableTools,
    REPOSITORY_CONTEXT: JSON.stringify(evidence),
  })
}

export function buildJsonToolFallbackPrompt(
  candidateToolIds: ReadonlySet<string>,
  activeToolIds: ReadonlySet<string>,
): string {
  return [
    '宿主通知：当前模型接口不支持原生函数调用。从这条消息开始改用下面的 JSON 工具协议；既有系统指令、用户请求和历史保持不变。',
    jsonToolsProtocol.trim(),
    '可按需加载的工具目录：',
    compactToolCatalog(candidateToolIds),
    '当前已加载工具及完整参数：',
    completeToolDefinitions(activeToolIds),
  ].join('\n\n')
}
