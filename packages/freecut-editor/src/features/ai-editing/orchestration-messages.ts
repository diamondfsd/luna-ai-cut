import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import { buildAiEditingSystemPrompt } from './agent-prompt'
import { getTimelineCodingSession } from './coding-workspace/session-registry'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import type { AiEditingRunOptions } from './run-types'
import { serializeForModel } from './tool-execution'
import type { AiEditingObservation } from './types'

export async function currentWorkspace(_options: AiEditingRunOptions): Promise<unknown> {
  return getTimelineCodingSession().promptContext()
}

export function toNativeMessages(messages: LlmMessage[]): EmbeddedAiAssistantMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }))
}

export async function buildInitialMessages(
  userText: string,
  history: LlmMessage[],
  evidence: unknown,
  protocol: 'native' | 'json',
  availableToolIds?: ReadonlySet<string>,
): Promise<LlmMessage[]> {
  return [
    {
      role: 'system',
      content: await buildAiEditingSystemPrompt(evidence, protocol, userText, availableToolIds),
    },
    ...history,
    { role: 'user', content: userText },
  ]
}

export async function buildJsonFallbackMessages(
  userText: string,
  history: LlmMessage[],
  observations: AiEditingObservation[],
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): Promise<LlmMessage[]> {
  const messages = await buildInitialMessages(
    userText,
    history,
    await currentWorkspace(options),
    'json',
    availableToolIds,
  )
  if (observations.length > 0) {
    messages.push({
      role: 'user',
      content: renderPrompt(fallbackProgressPrompt, {
        OBSERVATIONS: serializeForModel(observations),
      }),
    })
  }
  return messages
}
