import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'

export type AiEditingLogLevel = 'info' | 'warn' | 'error'

export function logAiEditingDiagnostic(
  level: AiEditingLogLevel,
  event: string,
  details?: Record<string, unknown>,
): void {
  getEmbeddedHostBridge().logAiEditing?.(level, event, details)
}

function summarizeValue(key: string, value: unknown): unknown {
  if (/key|token|secret|password|authorization/i.test(key)) return '[redacted]'
  if (typeof value === 'string') {
    if (key === 'content' || key === 'oldText' || key === 'newText' || key === 'arguments') {
      return { characters: value.length }
    }
    return value.length > 200 ? `${value.slice(0, 200)}...` : value
  }
  if (Array.isArray(value)) return value.map((item) => summarizeValue(key, item))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
      childKey,
      summarizeValue(childKey, childValue),
    ]),
  )
}

export function summarizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  return summarizeValue('args', args) as Record<string, unknown>
}

export function summarizeToolResult(result: {
  ok: boolean
  message: string
  data?: unknown
}): Record<string, unknown> {
  const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
    ? Object.fromEntries(Object.entries(result.data as Record<string, unknown>).map(([key, value]) => {
        if (key === 'content' || key === 'before' || key === 'after' || key === 'diff') {
          return [key, typeof value === 'string' ? { characters: value.length } : { included: true }]
        }
        if (Array.isArray(value)) return [key, { items: value.length }]
        if (value && typeof value === 'object') return [key, { included: true }]
        return [key, value]
      }))
    : undefined
  return { ok: result.ok, message: result.message, ...(data ? { data } : {}) }
}
