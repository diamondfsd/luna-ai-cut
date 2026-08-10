import type { AiFaceGroup } from '../shared/types'
import type { NormalizedFaceBounds } from './aiFaceOverlayGeometry'

export interface AiSelectionFaceOverlayFace {
  bounds: NormalizedFaceBounds
  label: string
}

export function faceBoxesForGroups(groups: AiFaceGroup[], groupIds: string[]): Map<string, AiSelectionFaceOverlayFace[]> {
  const selected = new Set(groupIds)
  const byItem = new Map<string, AiSelectionFaceOverlayFace[]>()
  for (const group of groups) {
    if (!selected.has(group.id)) continue
    for (const member of group.memberFaces) {
      const faces = byItem.get(member.itemId) ?? []
      faces.push({ bounds: member.bounds, label: group.name })
      byItem.set(member.itemId, faces)
    }
  }
  return byItem
}
