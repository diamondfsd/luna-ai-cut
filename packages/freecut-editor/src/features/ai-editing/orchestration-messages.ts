import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import {
  buildAiEditingSystemPrompt,
  buildAiEditingTurnContext,
} from './agent-prompt'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import { serializeToolResultsForModel } from './tool-execution'
import type { ToolResultStore } from './tool-result-store'
import type { AiEditingObservation } from './types'

function initialTurnContextMessage(
  evidence: unknown,
): string {
  return buildAiEditingTurnContext(evidence)
}

export function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

export function replayMessagesForJson(
  messages: readonly EmbeddedAiAssistantMessage[],
): LlmMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'user' as const,
        content: `工具调用 ${message.toolCallId} 的执行结果：\n${message.content}`,
      }
    }
    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      return { role: message.role, content: message.content ?? '' } as LlmMessage
    }
    const calls = message.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }))
    return {
      role: 'assistant',
      content: [
        message.content ?? '',
        `已请求工具调用：\n${JSON.stringify(calls)}`,
      ].filter(Boolean).join('\n\n'),
    }
  })
}

export async function buildInitialNativeMessages(
  userText: string,
  history: EmbeddedAiAssistantMessage[],
  evidence: unknown,
  availableToolIds: ReadonlySet<string>,
): Promise<EmbeddedAiAssistantMessage[]> {
  const firstTurnContext = history.length === 0
    ? [{
        role: 'system' as const,
        content: initialTurnContextMessage(evidence),
      }]
    : []
  return [
    {
      role: 'system',
      content: await buildAiEditingSystemPrompt('native', availableToolIds),
    },
    ...history,
    ...firstTurnContext,
    { role: 'user', content: userText },
  ]
}

export async function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
  availableToolIds: ReadonlySet<string>,
): Promise<LlmMessage[]> {
  const firstTurnContext: LlmMessage[] = history.length === 0
    ? [{
        role: 'system',
        content: initialTurnContextMessage(evidence),
      }]
    : []
  return [
    {
      role: 'system',
      content: await buildAiEditingSystemPrompt(protocol, availableToolIds),
    },
    ...history,
    ...firstTurnContext,
    { role: 'user', content: userText },
  ]
}

export function buildJsonFallbackMessages(
  initialMessages: LlmMessage[],
  observations: AiEditingObservation[],
  resultStore: ToolResultStore,
): LlmMessage[] {
  const messages = [...initialMessages]
  if (observations.length > 0) {
    messages.push({
      role: 'user',
      content: renderPrompt(fallbackProgressPrompt, {
        OBSERVATIONS: serializeToolResultsForModel(observations, resultStore),
      }),
    })
  }
  return messages
}
