import type { AgentTaskPurpose, AiEditorAgentEvent, AiEditorAgentSession } from './aiEditor'

export interface AgentTaskInput {
  request: string
  purpose?: AgentTaskPurpose
  projectId?: string | null
}
export interface AgentConversation {
  id: string
  agentId: string
  agentName: string
  purpose: AgentTaskPurpose
  request: string
  prompt: string
  createdAt: string
  updatedAt: string
  handoff: 'pending' | 'draft' | 'clipboard' | 'failed'
  error?: string
  session: AiEditorAgentSession
  events: AiEditorAgentEvent[]
}
export interface AgentTaskLaunchResult {
  conversation: AgentConversation
  mode: 'draft' | 'clipboard'
}
