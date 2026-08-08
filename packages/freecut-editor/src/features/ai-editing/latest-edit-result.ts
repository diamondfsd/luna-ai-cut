import type { AiEditingObservation } from './types'

export function latestFailedEdit(
  observations: readonly AiEditingObservation[],
): AiEditingObservation | undefined {
  const latestEdit = observations.findLast((entry) => entry.toolId === 'workspace.apply_edit_program')
  return latestEdit && !latestEdit.result.ok ? latestEdit : undefined
}
