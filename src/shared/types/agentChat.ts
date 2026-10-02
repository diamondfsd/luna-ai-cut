export interface AgentChatContext {
  purpose: 'editing' | 'director-plan'
  request?: string
  projectId?: string | null
}
