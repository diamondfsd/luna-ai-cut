import type {
  AiEditingConversationContext,
  AiEditingConversationWorkflow,
} from '@freecut/infrastructure/storage'
import type { AiEditingMessage } from './conversation-messages'
import type { AiEditingReasoningEffort } from './reasoning-effort'
import type { AiEditingResourceReference } from './resource-references'
import type {
  AiEditingObservation,
  AiEditingTaskActivity,
  AiEditingToolActivity,
} from './types'

export type AiEditingPhase = 'idle' | 'loading' | 'thinking' | 'executing'

export interface AiEditingState {
  supported: boolean
  phase: AiEditingPhase
  loadPercent: number
  thinkingLabel: string
  thinkingPercent: number
  thinkingCeiling: number
  error: string | null
  reasoningText: string
  draftAssistantText: string
  messages: AiEditingMessage[]
  agentContext: AiEditingConversationContext | null
  conversationWorkflow: AiEditingConversationWorkflow | null
  observations: AiEditingObservation[]
  toolActivities: AiEditingToolActivity[]
  taskActivities: AiEditingTaskActivity[]
  reasoningEffort: AiEditingReasoningEffort
  projectId: string | null
  isRestoringConversation: boolean
  isStartingNewConversation: boolean
  restoreConversation: (projectId: string | null) => Promise<void>
  submit: (text: string, references?: AiEditingResourceReference[]) => Promise<void>
  setReasoningEffort: (effort: AiEditingReasoningEffort) => void
  cancel: () => void
  startNewConversation: () => Promise<void>
  resumeConversation: (sessionId: string) => Promise<boolean>
}
