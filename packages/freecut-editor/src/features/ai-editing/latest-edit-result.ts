import type { AiEditingObservation } from './types'

export function latestFailedEdit(
  observations: readonly AiEditingObservation[],
): AiEditingObservation | undefined {
  const latestEdit = observations.findLast(
    (entry) => entry.toolId === 'timeline.commit' || entry.toolId === 'timeline.publish_stage',
  )
  return latestEdit && !latestEdit.result.ok ? latestEdit : undefined
}
