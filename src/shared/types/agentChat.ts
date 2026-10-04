import type { AgentTaskPurpose } from './aiEditor'

export interface AgentChatContext {
  purpose?: AgentTaskPurpose
  request?: string
  directorPlanId?: string
  projectId?: string | null
}
