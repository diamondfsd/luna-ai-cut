import type { AiEditingResponse, AiEditingToolCall } from './types'

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).toSorted()
  const expected = [...keys].toSorted()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseToolCall(value: unknown): AiEditingToolCall | null {
  const call = objectRecord(value)
  if (!call || !hasExactKeys(call, ['id', 'args'])) return null
  if (typeof call.id !== 'string' || call.id.length === 0) return null
  const args = objectRecord(call.args)
  return args ? { id: call.id, args } : null
}

export function parseAiEditingResponse(raw: string): AiEditingResponse | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  const response = objectRecord(value)
  if (!response || !hasExactKeys(response, ['reply', 'toolCalls'])) return null
  if (typeof response.reply !== 'string' || !Array.isArray(response.toolCalls)) return null

  const toolCalls: AiEditingToolCall[] = []
  for (const value of response.toolCalls) {
    const call = parseToolCall(value)
    if (!call) return null
    toolCalls.push(call)
  }

  return { reply: response.reply, toolCalls }
}
