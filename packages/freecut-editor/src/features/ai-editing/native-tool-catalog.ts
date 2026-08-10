import type {
  EmbeddedAiAssistantToolDefinition,
} from '@freecut/shared/host/embedded-host'
import { listAiEditingTools } from './tool-registry'

export interface NativeToolCatalog {
  definitions: EmbeddedAiAssistantToolDefinition[]
  idsByFunctionName: Map<string, string>
}

function nativeFunctionName(toolId: string): string {
  return `fc_${toolId.replaceAll('.', '_')}`
}

export function createNativeToolCatalog(availableToolIds?: ReadonlySet<string>): NativeToolCatalog {
  const idsByFunctionName = new Map<string, string>()
  const definitions = listAiEditingTools()
    .filter((tool) => !availableToolIds || availableToolIds.has(tool.id))
    .map((tool) => {
      const name = nativeFunctionName(tool.id)
      if (idsByFunctionName.has(name)) throw new Error('剪辑助手工具名称重复，无法继续。')
      idsByFunctionName.set(name, tool.id)
      return {
        name,
        description: `${tool.title}。${tool.description}`,
        parameters: tool.inputSchema,
      }
    })
  return { definitions, idsByFunctionName }
}
