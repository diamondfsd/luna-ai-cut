import type { SelectionState } from '@freecut/shared/state/selection/types'

export function shouldSuppressTimelineItemClickAfterDrag(
  activeTool: SelectionState['activeTool'],
  dragWasActive: boolean,
): boolean {
  if (!dragWasActive) {
    return false
  }

  return activeTool === 'select' || activeTool === 'trim-edit'
}
