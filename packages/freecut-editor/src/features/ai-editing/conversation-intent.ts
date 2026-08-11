import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { AiEditingConversationWorkflow } from '@freecut/infrastructure/storage'

export type AiEditingTurnIntent =
  | { kind: 'conversation' }
  | {
      kind: 'execute-approved-plan'
      planMessageId?: string
      source: 'workflow' | 'history'
    }

interface ConversationMessage extends LlmMessage {
  id?: string
}

const CONVERSATION_INTENT: AiEditingTurnIntent = { kind: 'conversation' }

function normalizedConfirmation(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s，,。.!！、;；:：]/g, '')
}

function isPlanConfirmation(text: string): boolean {
  const normalized = normalizedConfirmation(text)
  if (!normalized || /[?？]|怎么样|好不好|是否|能不能/.test(text)) return false
  if (/^(ok|okay|好的?|可以|行|没问题)$/.test(normalized)) return true
  return /^(?:(?:ok|okay|好的?|可以|行|没问题))?(?:就)?(?:按照|按|照|依照|采用|用)(?:这个|此|刚才的|上面的)?(?:方案|脚本|分镜)?(?:来|执行|做|剪|开始)?(?:吧|了|就行)?$/.test(normalized)
}

function latestAssistantMessage(history: readonly ConversationMessage[]): ConversationMessage | null {
  return history.findLast((message) => message.role === 'assistant') ?? null
}

export function looksLikeDeliveredEditingPlan(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 20) return false
  const planTerms = trimmed.match(/脚本|方案|分镜|镜头|画面|剪辑|节奏|开场|收尾/g) ?? []
  return planTerms.length >= 2 || /(脚本|方案|分镜).{0,24}(开场|镜头|画面|剪辑)/s.test(trimmed)
}

export function isEditingPlanRequest(text: string): boolean {
  return /(脚本|方案|分镜|剪辑思路|剪辑结构)/.test(text) &&
    /(设计|写|做|出|给|规划|整理|想)/.test(text)
}

export function resolveAiEditingTurnIntent(
  userText: string,
  history: readonly ConversationMessage[],
  workflow: AiEditingConversationWorkflow | null = null,
): AiEditingTurnIntent {
  if (!isPlanConfirmation(userText)) return CONVERSATION_INTENT

  const previousAssistant = latestAssistantMessage(history)
  if (!previousAssistant) return CONVERSATION_INTENT

  if (
    workflow?.kind === 'awaiting-plan-confirmation' &&
    previousAssistant.id === workflow.planMessageId
  ) {
    return {
      kind: 'execute-approved-plan',
      planMessageId: workflow.planMessageId,
      source: 'workflow',
    }
  }

  // Existing version-2 conversations did not persist workflow state. Infer it
  // once from the immediately preceding assistant delivery so those sessions
  // can still cross the plan -> execution boundary.
  if (looksLikeDeliveredEditingPlan(previousAssistant.content)) {
    return {
      kind: 'execute-approved-plan',
      ...(previousAssistant.id ? { planMessageId: previousAssistant.id } : {}),
      source: 'history',
    }
  }

  return CONVERSATION_INTENT
}

export function nextConversationWorkflow(input: {
  previous: AiEditingConversationWorkflow | null
  intent: AiEditingTurnIntent
  userText: string
  assistantMessageId: string
  assistantReply: string
  completed: boolean
  changedTimeline: boolean
  now?: number
}): AiEditingConversationWorkflow | null {
  if (!input.completed) return input.previous
  if (input.intent.kind === 'execute-approved-plan' || input.changedTimeline) return null
  if (
    isEditingPlanRequest(input.userText) &&
    looksLikeDeliveredEditingPlan(input.assistantReply)
  ) {
    return {
      kind: 'awaiting-plan-confirmation',
      planMessageId: input.assistantMessageId,
      updatedAt: input.now ?? Date.now(),
    }
  }
  return null
}
