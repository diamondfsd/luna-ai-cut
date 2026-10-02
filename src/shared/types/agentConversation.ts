import type { AiEditorAgentEvent, AiEditorAgentSession } from './aiEditor'

export interface AgentTaskInput {
  request: string
  purpose: 'editing' | 'director-plan'
  projectId?: string | null
}
export interface AgentConversation {
  id: string
  agentId: string
  agentName: string
  purpose: 'editing' | 'director-plan'
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
