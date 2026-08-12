export interface AiEditingAgentToolCall {
  id: string
  name: string
  arguments: string
}

export type AiEditingAgentMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: AiEditingAgentToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface AiEditingAgentTurn {
  id: string
  protocol: 'native' | 'json'
  createdAt: number
  messages: AiEditingAgentMessage[]
}

function sanitizeToolCall(value: unknown): AiEditingAgentToolCall | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingAgentToolCall>
  if (
    typeof candidate.id !== 'string' || !candidate.id ||
    typeof candidate.name !== 'string' || !candidate.name ||
    typeof candidate.arguments !== 'string'
  ) return null
  return { id: candidate.id, name: candidate.name, arguments: candidate.arguments }
}

function sanitizeAgentMessage(value: unknown): AiEditingAgentMessage | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if ((candidate.role === 'system' || candidate.role === 'user') &&
    typeof candidate.content === 'string') {
    return { role: candidate.role, content: candidate.content }
  }
  if (candidate.role === 'tool' &&
    typeof candidate.toolCallId === 'string' && candidate.toolCallId &&
    typeof candidate.content === 'string') {
    return { role: 'tool', toolCallId: candidate.toolCallId, content: candidate.content }
  }
  if (candidate.role !== 'assistant') return null
  const content = typeof candidate.content === 'string' ? candidate.content : undefined
  const toolCalls = Array.isArray(candidate.toolCalls)
    ? candidate.toolCalls.map(sanitizeToolCall)
    : []
  if (toolCalls.some((call) => call === null) || (!content && toolCalls.length === 0)) return null
  return {
    role: 'assistant',
    ...(content ? { content } : {}),
    ...(toolCalls.length > 0 ? { toolCalls: toolCalls as AiEditingAgentToolCall[] } : {}),
  }
}

function hasCompleteToolExchanges(messages: readonly AiEditingAgentMessage[]): boolean {
  const pending = new Set<string>()
  const seen = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.toolCallId)) return false
      continue
    }
    if (pending.size > 0) return false
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      if (seen.has(call.id)) return false
      seen.add(call.id)
      pending.add(call.id)
    }
  }
  return pending.size === 0
}

export function sanitizeAgentTurn(value: unknown): AiEditingAgentTurn | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<AiEditingAgentTurn>
  if (
    typeof candidate.id !== 'string' || !candidate.id ||
    (candidate.protocol !== 'native' && candidate.protocol !== 'json') ||
    typeof candidate.createdAt !== 'number' || !Number.isFinite(candidate.createdAt) ||
    candidate.createdAt < 0 || !Array.isArray(candidate.messages)
  ) return null
  const messages = candidate.messages.map(sanitizeAgentMessage)
  if (
    messages.length === 0 || messages.some((message) => message === null) ||
    !messages.some((message) => message?.role === 'user') ||
    !hasCompleteToolExchanges(messages as AiEditingAgentMessage[])
  ) return null
  return {
    id: candidate.id,
    protocol: candidate.protocol,
    createdAt: candidate.createdAt,
    messages: messages as AiEditingAgentMessage[],
  }
}

export function sanitizeLoadedToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))]
}
