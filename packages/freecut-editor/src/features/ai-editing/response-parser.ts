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

function parseValue(value: unknown): AiEditingResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { reply?: unknown; toolCalls?: unknown }
  if (typeof candidate.reply !== 'string' || !Array.isArray(candidate.toolCalls)) return null

  const toolCalls: AiEditingToolCall[] = []
  for (const toolCall of candidate.toolCalls) {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) return null
    const call = toolCall as { id?: unknown; args?: unknown }
    if (typeof call.id !== 'string' || !call.args || typeof call.args !== 'object' || Array.isArray(call.args)) {
      return null
    }
    toolCalls.push({ id: call.id, args: call.args as Record<string, unknown> })
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
