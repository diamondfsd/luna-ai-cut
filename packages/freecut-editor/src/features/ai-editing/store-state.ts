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
  | 'agentContext'
  | 'conversationWorkflow'
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
    agentContext: null,
    conversationWorkflow: null,
    observations: [],
    toolActivities: [],
    taskActivities: [],
  }
}
