import type { LlmAdapter, LlmMessage } from '@freecut/infrastructure/llm'
import type { AiEditingConversationContext } from '@freecut/infrastructure/storage'
import {
  AgentContextManager,
  createLlmContextCompactor,
} from './agent-harness/context-manager'

interface ConversationMessage extends LlmMessage {
  id: string
}

interface PrepareConversationContextOptions {
  adapter: LlmAdapter
  signal?: AbortSignal
  onCompacting?: () => void
}

export interface PreparedConversationContext {
  history: LlmMessage[]
  context: AiEditingConversationContext | null
}

export async function prepareConversationContext(
  messages: readonly ConversationMessage[],
  storedContext: AiEditingConversationContext | null,
  options: PrepareConversationContextOptions,
): Promise<PreparedConversationContext> {
  const result = await new AgentContextManager(
    createLlmContextCompactor(options.adapter),
  ).prepare(messages, storedContext, options)
  return { history: result.history, context: result.checkpoint }
}
