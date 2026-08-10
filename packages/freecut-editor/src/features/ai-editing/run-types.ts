import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AgentWorkspaceDocument } from './edit-program/types'
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
  completionNotes: string[]
  timelineRevisionBefore: number
  timelineRevisionAfter: number
  production?: { blueprint: unknown; review: unknown }
}

export interface AiEditingTraceEvent {
  type: string
  message: string
  data?: unknown
}

export interface AiEditingRunOptions {
  history: LlmMessage[]
  signal?: AbortSignal
  onToken?: (delta: string, fullText: string) => void
  onToolActivity?: (activity: AiEditingToolActivity) => void
  onTaskActivity?: (activity: AiEditingTaskActivity) => void
  onRunProgress?: (progress: AiEditingRunProgress) => void
  onTraceEvent?: (event: AiEditingTraceEvent) => void
  adapter?: LlmAdapter
  reasoningEffort?: 'low' | 'high' | 'xhigh' | 'max'
  activityScope?: string
  scopeWorkspace?: (workspace: AgentWorkspaceDocument) => AgentWorkspaceDocument
}
