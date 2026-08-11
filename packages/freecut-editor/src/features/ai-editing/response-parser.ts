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

function parseToolCall(value: unknown): AiEditingToolCall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const call = value as { id?: unknown; args?: unknown }
  if (
    typeof call.id !== 'string' ||
    !call.args ||
    typeof call.args !== 'object' ||
    Array.isArray(call.args)
  ) {
    return null
  }
  return { id: call.id, args: call.args as Record<string, unknown> }
}

function parseValue(value: unknown, depth = 0): AiEditingResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { reply?: unknown; toolCalls?: unknown; json?: unknown }

  if (depth < 2 && typeof candidate.json === 'string') {
    try {
      return parseValue(JSON.parse(candidate.json), depth + 1)
    } catch {
      return null
    }
  }

  const singleCall = parseToolCall(value)
  if (singleCall) return { reply: '', toolCalls: [singleCall] }
  if (typeof candidate.reply !== 'string' || !Array.isArray(candidate.toolCalls)) return null

  const toolCalls: AiEditingToolCall[] = []
  for (const toolCall of candidate.toolCalls) {
    const parsed = parseToolCall(toolCall)
    if (!parsed) return null
    toolCalls.push(parsed)
  }

  return { reply: candidate.reply, toolCalls }
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
