import type { LlmAdapter, LlmMessage, LlmTokenUsage } from '@freecut/infrastructure/llm'
import type { AgentWorkspaceDocument } from './edit-program/types'
import type { AiEditingTurnIntent } from './conversation-intent'
import type { AiEditingAgentTurn } from './agent-harness'
import type { AgentReplayMessage } from './agent-harness'
import type {
  AiEditingObservation,
  AiEditingRunProgress,
  AiEditingTaskActivity,
  AiEditingToolActivity,
} from './types'

export interface AiEditingRunResult {
  reply: string
  observations: AiEditingObservation[]
  skillId?: string
  plan: string[]
  completed: boolean
  changedProject: boolean
  completionNotes: string[]
  agentTurn: AiEditingAgentTurn
  loadedToolIds: string[]
  production?: { blueprint: unknown; review: unknown }
}

export interface AiEditingTraceEvent {
  type: string
  message: string
  data?: unknown
}

export interface AiEditingRunOptions {
  history: LlmMessage[]
  agentHistory?: AgentReplayMessage[]
  loadedToolIds?: string[]
  /** Reuse a protocol already negotiated by an earlier turn in this conversation. */
  preferredProtocol?: 'native' | 'json'
  signal?: AbortSignal
  /** Cumulative final-answer Markdown, updated while the model is streaming. */
  onFinalText?: (text: string) => void
  onToolActivity?: (activity: AiEditingToolActivity) => void
  onTaskActivity?: (activity: AiEditingTaskActivity) => void
  onRunProgress?: (progress: AiEditingRunProgress) => void
  onTraceEvent?: (event: AiEditingTraceEvent) => void
  onModelUsage?: (usage: LlmTokenUsage) => void
  adapter?: LlmAdapter
  reasoningEffort?: 'low' | 'high' | 'xhigh' | 'max'
  activityScope?: string
  scopeWorkspace?: (workspace: AgentWorkspaceDocument) => AgentWorkspaceDocument
  turnIntent?: AiEditingTurnIntent
}
