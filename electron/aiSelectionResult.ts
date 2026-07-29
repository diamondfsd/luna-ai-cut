import type { AiSelectionSession } from '../src/shared/types'
import { applySelectionPlan, buildShootingEvents, buildSimilarityGroups } from './aiSelectionAlgorithms'
import { buildGlobalFaceGroups } from './aiSelectionPeopleManager'

export function rebuildSelectionResult(session: AiSelectionSession): void {
  const generatedScenes = buildShootingEvents(session.items)
  const existingModifiedScenes = session.scenes.filter((scene) => scene.userModified || scene.confirmation !== 'pending')
  const claimedSceneItems = new Set(existingModifiedScenes.flatMap((scene) => scene.itemIds))
  const remainingScenes = generatedScenes.flatMap((scene) => {
    const itemIds = scene.itemIds.filter((id) => !claimedSceneItems.has(id))
    if (itemIds.length === 0) return []
    return [{ ...scene, itemIds, coverItemId: itemIds.includes(scene.coverItemId) ? scene.coverItemId : itemIds[0] }]
  })
  session.scenes = [...existingModifiedScenes, ...remainingScenes].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
  const sceneByItem = new Map(session.scenes.flatMap((scene) => scene.itemIds.map((id) => [id, scene.id] as const)))
  session.items.forEach((item) => { item.sceneId = sceneByItem.get(item.id) ?? null })

  const generatedGroups = buildSimilarityGroups(session.items, session.scenes)
  const modifiedGroups = session.groups.filter((group) => group.userModified || group.confirmation !== 'pending')
  const modifiedItemIds = new Set(modifiedGroups.flatMap((group) => group.itemIds))
  session.groups = [
    ...modifiedGroups,
    ...generatedGroups.filter((group) => !group.itemIds.some((id) => modifiedItemIds.has(id))),
  ]
  session.faceGroups = buildGlobalFaceGroups(session.items)
  applySelectionPlan(session.items, session.groups, session.preset, session.purpose, session.target, session.preferenceProfile)
  for (const scene of session.scenes) {
    scene.recommendedCount = scene.itemIds.filter((id) => session.items.find((item) => item.id === id)?.flags.aiRecommended).length
    scene.coverItemId = scene.itemIds.find((id) => session.items.find((item) => item.id === id)?.flags.aiRecommended) ?? scene.coverItemId
  }
}
