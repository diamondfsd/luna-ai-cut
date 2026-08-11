import type { AiEditingState } from './store-types'

type ResettableConversationState = Pick<
  AiEditingState,
  | 'phase'
  | 'loadPercent'
  | 'thinkingLabel'
  | 'thinkingPercent'
  | 'thinkingCeiling'
  | 'error'
  | 'reasoningText'
  | 'draftAssistantText'
  | 'messages'
  | 'agentTurns'
  | 'loadedToolIds'
  | 'agentContext'
  | 'conversationWorkflow'
  | 'lastPromptTokens'
  | 'observations'
  | 'toolActivities'
  | 'taskActivities'
>

export function createEmptyConversationState(): ResettableConversationState {
  return {
    phase: 'idle',
    loadPercent: 0,
    thinkingLabel: '正在理解需求',
    thinkingPercent: 0,
    thinkingCeiling: 0,
    error: null,
    reasoningText: '',
    draftAssistantText: '',
    messages: [],
    agentTurns: [],
    loadedToolIds: [],
    agentContext: null,
    conversationWorkflow: null,
    lastPromptTokens: null,
    observations: [],
    toolActivities: [],
    taskActivities: [],
  }
}
