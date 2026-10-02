import { buildAssistantAgentPrompt } from './assistantAgentPrompt.ts'
import type { AiEditorHttpConnection } from '../shared/types'

/** Compatibility entry; all HTTP handoffs use live skill discovery. */
export function buildDirectorPlanAgentPrompt(connection: AiEditorHttpConnection, userRequest: string): string {
  return buildAssistantAgentPrompt(connection, userRequest)
}
