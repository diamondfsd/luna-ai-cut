import type { AgentTaskPurpose } from './aiEditor'

export interface AgentChatContext {
  purpose?: AgentTaskPurpose
  request?: string
  projectId?: string | null
}
