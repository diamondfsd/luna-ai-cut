import type { AiSelectionItem, WorkspaceMediaAsset } from '../src/shared/types'

export function workspaceAssetsFromSelection(items: AiSelectionItem[]): WorkspaceMediaAsset[] {
  return items.filter((item) => item.state === 'kept' && !item.error).flatMap((item) => {
    const segments = item.videoSegments.filter((candidate) => candidate.state === 'kept')
    if (item.kind === 'video' && segments.length > 0) return segments.map((segment, index) => ({
      id: `${item.id}_${segment.id}`,
      name: segments.length > 1 ? `${item.name} 片段 ${index + 1}` : item.name,
      path: item.path,
      kind: item.kind,
      thumbnailUrl: item.videoKeyframes.find((frame) => frame.time >= segment.startTime)?.thumbnailUrl ?? item.thumbnailUrl,
      pipeline: { trim: { startTime: segment.startTime, endTime: segment.endTime } },
    }))
    return [{ id: item.id, name: item.name, path: item.path, kind: item.kind, thumbnailUrl: item.thumbnailUrl }]
  })
}
