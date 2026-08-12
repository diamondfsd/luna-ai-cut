import type { AgentHarnessToolCall } from './agent-harness'
import { getAiEditingTool } from './tool-registry'
import type { AiEditingObservation } from './types'

export const MAX_REPEATED_EDIT_FAILURES = 2

export function repeatedEditFailureCount(observation: AiEditingObservation | undefined): number {
  const data = observation?.result.data
  if (!data || typeof data !== 'object') return 0
  const count = (data as { repeatedEditFailureCount?: unknown }).repeatedEditFailureCount
  return typeof count === 'number' ? count : 0
}

export function editFailureKey(
  call: AgentHarnessToolCall,
  observation: AiEditingObservation,
): string | null {
  if (observation.result.ok || getAiEditingTool(call.toolId)?.risk !== 'edit') return null
  const data = observation.result.data
  const error = data && typeof data === 'object'
    ? (data as { error?: { code?: unknown } }).error
    : undefined
  const code = typeof error?.code === 'string' ? error.code : observation.result.message
  const input = call.input as Record<string, unknown>
  const targets = typeof input.path === 'string'
    ? [input.path]
    : Array.isArray(input.changes)
      ? input.changes.flatMap((change) => (
          change && typeof change === 'object' && typeof (change as { path?: unknown }).path === 'string'
            ? [(change as { path: string }).path]
            : []
        )).sort()
      : []
  return `${call.toolId}:${targets.join(',')}:${code}`
}
