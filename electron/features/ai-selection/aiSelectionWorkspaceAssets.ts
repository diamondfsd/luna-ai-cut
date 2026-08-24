import type { AiSelectionItem, WorkspaceMediaAsset } from '../../../src/shared/types'

export function workspaceAssetsFromSelection(items: AiSelectionItem[]): WorkspaceMediaAsset[] {
  return items
    .filter((item) => item.state === 'kept' && !item.error)
    .map((item) => ({
      id: item.id,
      name: item.name,
      path: item.path,
      kind: item.kind,
      thumbnailUrl: item.thumbnailUrl,
    }))
}
