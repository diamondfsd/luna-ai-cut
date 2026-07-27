import type { AiFaceGroup } from '../shared/types'

export interface AiCoPhotoGroup {
  id: string
  name: string
  itemIds: string[]
  coverItemId: string
  faceGroupIds: string[]
}

function coPhotoName(names: string[]): string {
  if (names.length === 2) return `${names[0]}和${names[1]}的合照`
  return `${names.slice(0, -1).join('、')}和${names[names.length - 1]}的合照`
}

export function buildCoPhotoGroups(faceGroups: AiFaceGroup[]): AiCoPhotoGroup[] {
  const groupsByItem = new Map<string, AiFaceGroup[]>()
  for (const group of faceGroups) {
    for (const itemId of group.itemIds) {
      const memberships = groupsByItem.get(itemId) ?? []
      memberships.push(group)
      groupsByItem.set(itemId, memberships)
    }
  }

  const coPhotos = new Map<string, AiCoPhotoGroup>()
  for (const [itemId, memberships] of groupsByItem) {
    if (memberships.length < 2) continue
    const people = [...memberships].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id))
    const faceGroupIds = people.map((group) => group.id).sort()
    const id = `co-photo:${faceGroupIds.join('|')}`
    const current = coPhotos.get(id)
    if (current) current.itemIds.push(itemId)
    else coPhotos.set(id, {
      id,
      name: coPhotoName(people.map((group) => group.name)),
      itemIds: [itemId],
      coverItemId: itemId,
      faceGroupIds,
    })
  }

  return [...coPhotos.values()].sort((left, right) => right.itemIds.length - left.itemIds.length || left.name.localeCompare(right.name, 'zh-CN'))
}
