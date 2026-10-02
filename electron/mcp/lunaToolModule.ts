import type { AiEditorMcpResponse } from '../../src/shared/types/aiEditor.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

export interface LunaToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}
/** Domains own schemas, execution and task policies; transports never enumerate domain names. */
export interface LunaToolModule {
  id: string
  tools: readonly LunaToolDefinition[]
  allowedPurposes?: readonly string[]
  execute(name: string, args: Record<string, unknown>, context: LunaMcpServerOptions, callId: string): Promise<AiEditorMcpResponse | null>
}

export function createToolRegistry(modules: readonly LunaToolModule[]) {
  const owners = new Map<string, LunaToolModule>()
  for (const module of modules) {
    for (const tool of module.tools) {
      if (owners.has(tool.name)) throw new Error(`Duplicate tool registration: ${tool.name}`)
      owners.set(tool.name, module)
    }
  }
  return {
    tools: modules.flatMap(module => module.tools.map(tool => ({ ...tool, _meta: { module: module.id } }))),
    resolve: (name: string) => owners.get(name),
  }
}
