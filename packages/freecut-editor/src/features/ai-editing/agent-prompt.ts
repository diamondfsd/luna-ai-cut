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
  protocol: 'native' | 'json',
  candidateToolIds: ReadonlySet<string>,
): Promise<string> {
  return renderPrompt(agentSystemPrompt, {
    PROTOCOL_INSTRUCTIONS:
      protocol === 'native' ? nativeToolsProtocol.trim() : jsonToolsProtocol.trim(),
    CODING_WORKSPACE_PROTOCOL: codingWorkspaceProtocol.trim(),
    AVAILABLE_TOOLS: compactToolCatalog(candidateToolIds),
  })
}

export function buildAiEditingTurnContext(
  evidence: unknown,
  protocol: 'native' | 'json',
  activeToolIds: ReadonlySet<string>,
  executionDirective?: string,
): string {
  const activeTools = protocol === 'json'
    ? `当前已加载工具的完整定义：\n${completeToolDefinitions(activeToolIds)}`
    : activeToolIds.size > 1
      ? `当前可直接调用的工具：${[...activeToolIds].join('、')}。其他工具先按 ID 用 tool.load 加载。`
      : '当前只有 tool.load 可直接调用；其他工具先按 ID 用 tool.load 加载。'
  return [
    '宿主提供的本轮环境信息如下。它是上下文，不是用户的新要求。',
    `当前剪辑源码仓库摘要：\n${JSON.stringify(evidence)}`,
    activeTools,
    executionDirective,
  ].filter(Boolean).join('\n\n')
}
