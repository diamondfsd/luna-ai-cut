import type { AiEditingObservation } from './types'

const TIMELINE_OUTCOME_TOOL_IDS = new Set([
  'source.replace',
  'source.create',
  'source.remove',
  'source.apply_changes',
  'timeline.check',
  'git.commit',
])

export function latestFailedEdit(
  observations: readonly AiEditingObservation[],
): AiEditingObservation | undefined {
  const successfulCommit = observations.findLast((entry) => (
    entry.toolId === 'git.commit' && entry.result.ok &&
    Boolean(entry.result.data && typeof entry.result.data === 'object' &&
      (entry.result.data as { created?: unknown }).created === true)
  ))
  if (successfulCommit) return undefined
  const latestEdit = observations.findLast((entry) => TIMELINE_OUTCOME_TOOL_IDS.has(entry.toolId))
  return latestEdit && !latestEdit.result.ok ? latestEdit : undefined
}

export function failedEditMessage(observation: AiEditingObservation): string {
  const data = observation.result.data
  if (data && typeof data === 'object' && 'diagnostics' in data && Array.isArray(data.diagnostics)) {
    const diagnostic = data.diagnostics.find(
      (entry): entry is { message: string } =>
        Boolean(entry) && typeof entry === 'object' && typeof entry.message === 'string',
    )
    if (diagnostic) return diagnostic.message
  }
  return observation.result.message
}
