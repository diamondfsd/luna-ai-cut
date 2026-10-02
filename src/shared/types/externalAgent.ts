import type { AgentChatContext } from './agentChat'
export interface ExternalAgentDescriptor {
  id: string
  name: string
  capabilities: {
    open: boolean
    download: boolean
    skillInstallation: boolean
    task: 'draft' | 'clipboard' | 'unsupported'
  }
}
export interface ExternalAgentTaskRequest {
  prompt: string
}
export interface ExternalAgentTaskResult {
  mode: 'draft' | 'clipboard'
}
export interface ExternalAgentApi {
  openChat(context: AgentChatContext): Promise<void>
  onOpenChat(callback: (context: AgentChatContext) => void): () => void
  list(): Promise<ExternalAgentDescriptor[]>
  isInstalled(agentId: string): Promise<boolean>
  open(agentId: string): Promise<void>
  download(agentId: string): Promise<void>
  installSkill(agentId: string): Promise<void>
  startTask(agentId: string, request: ExternalAgentTaskRequest): Promise<ExternalAgentTaskResult>
}
