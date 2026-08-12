import type { AiEditingResponse, AiEditingToolCall } from './types'

function jsonObjectCandidates(raw: string): string[] {
  const candidates: string[] = []
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        quoted = false
      }
      continue
    }

    if (character === '"') {
      quoted = true
    } else if (character === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (character === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(raw.slice(start, index + 1))
        start = -1
      }
    }
  }

  return candidates
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseArguments(value: unknown): Record<string, unknown> | null {
  const record = objectRecord(value)
  if (record) return record
  if (typeof value !== 'string') return null
  try {
    return objectRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function parseToolCall(value: unknown): AiEditingToolCall | null {
  const call = objectRecord(value)
  if (!call) return null
  const entries = Object.entries(call)
  if (entries.length === 1) {
    const [toolId, shorthandArgs] = entries[0]!
    const args = objectRecord(shorthandArgs)
    if (/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(toolId) && args) {
      return { id: toolId, args }
    }
  }
  const fn = objectRecord(call.function)
  const id = typeof fn?.name === 'string'
    ? fn.name
    : typeof call.id === 'string'
      ? call.id
      : typeof call.toolId === 'string'
        ? call.toolId
      : typeof call.name === 'string'
        ? call.name
        : null
  if (!id) return null

  const explicitArgs = parseArguments(fn?.arguments ?? call.args ?? call.arguments ?? call.input)
  if (explicitArgs) return { id, args: explicitArgs }

  const args = Object.fromEntries(
    Object.entries(call).filter(([key]) =>
      !['id', 'toolId', 'name', 'type', 'function', 'args', 'arguments', 'input'].includes(key),
    ),
  )
  return Object.keys(args).length > 0 ? { id, args } : null
}

function parseValue(value: unknown, depth = 0): AiEditingResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as {
    reply?: unknown
    content?: unknown
    toolCalls?: unknown
    tool_calls?: unknown
    calls?: unknown
    json?: unknown
  }

  if (depth < 2 && typeof candidate.json === 'string') {
    try {
      return parseValue(JSON.parse(candidate.json), depth + 1)
    } catch {
      return null
    }
  }

  const singleCall = parseToolCall(value)
  if (singleCall) return { reply: '', toolCalls: [singleCall] }
  const reply = typeof candidate.reply === 'string'
    ? candidate.reply
    : typeof candidate.content === 'string'
      ? candidate.content
      : ''
  const rawToolCalls = candidate.toolCalls ?? candidate.tool_calls ?? candidate.calls
  if (rawToolCalls === undefined) {
    return reply ? { reply, toolCalls: [] } : null
  }
  if (!Array.isArray(rawToolCalls)) return null

  const toolCalls: AiEditingToolCall[] = []
  for (const toolCall of rawToolCalls) {
    const parsed = parseToolCall(toolCall)
    if (!parsed) return null
    toolCalls.push(parsed)
  }

  return reply || toolCalls.length > 0 ? { reply, toolCalls } : null
}

/**
 * Models sometimes add a short introduction or a fenced block around an
 * otherwise valid response. Parse complete top-level objects individually so
 * that unrelated braces in the introduction do not invalidate the plan.
 */
export function parseAiEditingResponse(raw: string): AiEditingResponse | null {
  for (const candidate of jsonObjectCandidates(raw).toReversed()) {
    try {
      const response = parseValue(JSON.parse(candidate))
      if (response) return response
    } catch {
      // Try the next complete object in the response.
    }
  }
  return null
}
