import { listEditorTools } from '@freecut/features/editor/agent/tools/registry'
import { removeFillersTool, removeSilenceTool } from '../cleanup-tools'
import type { AiEditingTool, AiEditingToolModule } from '../types'

function legacyTimelineTools(): AiEditingTool[] {
  return listEditorTools().filter((tool) => !tool.handoff).map((tool) => ({
    id: `timeline.${tool.name}`,
    title: tool.title,
    description: tool.description,
    risk: tool.readOnly ? 'read' : tool.handoff ? 'analysis' : 'edit',
    execution: 'sync',
    inputSchema: tool.inputSchema,
    validate: tool.validate,
    summarize: tool.summarize,
    execute: (args) => tool.execute(args),
  }))
}

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [removeSilenceTool, removeFillersTool, ...legacyTimelineTools()],
}
