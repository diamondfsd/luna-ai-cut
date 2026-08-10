import type { LlmMessage } from '@freecut/infrastructure/llm'
import type { EmbeddedAiAssistantMessage } from '@freecut/shared/host/embedded-host'
import { buildAiEditingSystemPrompt } from './agent-prompt'
import type { AgentWorkspaceDocument } from './edit-program/types'
import fallbackProgressPrompt from './prompts/messages/fallback-progress.md?raw'
import { renderPrompt } from './prompts/render-prompt'
import type { AiEditingRunOptions } from './run-types'
import { serializeForModel } from './tool-execution'
import type { AiEditingObservation } from './types'
import { buildAgentWorkspaceDocument } from './workspace-document/build-workspace-document'

export async function currentWorkspace(
  options: AiEditingRunOptions,
): Promise<AgentWorkspaceDocument> {
  const workspace = await buildAgentWorkspaceDocument()
  return options.scopeWorkspace?.(workspace) ?? workspace
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
    { role: 'system', content: await buildAiEditingSystemPrompt(evidence, protocol, userText, availableToolIds) },
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
      content: renderPrompt(fallbackProgressPrompt, { OBSERVATIONS: serializeForModel(observations) }),
    })
  }
  return messages
}
