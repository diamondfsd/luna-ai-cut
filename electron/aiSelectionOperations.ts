import type { AiSelectionItem, AiSelectionSession, AiSelectionUserOperation } from '../src/shared/types'
import { applySelectionPlan, applyVideoSegmentSelection, normalizeSelectionTarget } from './aiSelectionAlgorithms.ts'

export type AiSelectionSnapshot = Pick<AiSelectionSession, 'preset' | 'purpose' | 'target' | 'items' | 'scenes' | 'groups' | 'preferenceProfile'>

export function createAiSelectionSnapshot(session: AiSelectionSnapshot): AiSelectionSnapshot {
  return structuredClone({
    preset: session.preset,
    purpose: session.purpose,
    target: session.target,
    items: session.items,
    scenes: session.scenes,
    groups: session.groups,
    preferenceProfile: session.preferenceProfile,
  })
}

function requireItem(items: AiSelectionItem[], id: string): AiSelectionItem {
  const item = items.find((candidate) => candidate.id === id)
  if (!item) throw new Error('素材不存在')
  return item
}

function acceptRecommendations(items: AiSelectionItem[]): void {
  for (const item of items) {
    if (item.decisionSource === 'user') continue
    if (item.state === 'recommended') { item.state = 'kept'; item.decisionSource = 'user' }
    else if (item.state === 'alternative') { item.state = 'rejected'; item.decisionSource = 'user' }
  }
}

function learnPreference(session: AiSelectionSnapshot, item: AiSelectionItem, kept: boolean): void {
  const direction = kept ? 1 : -1
  const keys = Object.keys(session.preferenceProfile.weights) as Array<keyof typeof session.preferenceProfile.weights>
  for (const key of keys) {
    const signal = item.scores[key].normalized - 0.5
    session.preferenceProfile.weights[key] = Math.max(0.02, session.preferenceProfile.weights[key] + direction * signal * 0.025)
  }
  const total = keys.reduce((sum, key) => sum + session.preferenceProfile.weights[key], 0) || 1
  keys.forEach((key) => { session.preferenceProfile.weights[key] /= total })
  session.preferenceProfile.sampleCount += 1
}

export function applyAiSelectionUserOperation(session: AiSelectionSnapshot, operation: AiSelectionUserOperation): void {
  if (operation.type === 'set-preset') {
    session.preset = operation.preset
    applySelectionPlan(session.items, session.groups, session.preset, session.purpose, session.target, session.preferenceProfile)
    return
  }
  if (operation.type === 'set-purpose') {
    session.purpose = operation.purpose
    applySelectionPlan(session.items, session.groups, session.preset, session.purpose, session.target, session.preferenceProfile)
    return
  }
  if (operation.type === 'set-target') {
    session.target = normalizeSelectionTarget(operation.target)
    applySelectionPlan(session.items, session.groups, session.preset, session.purpose, session.target, session.preferenceProfile)
    return
  }
  if (operation.type === 'set-state') {
    const item = requireItem(session.items, operation.itemId)
    item.state = operation.state
    item.decisionSource = 'user'
    if (operation.state === 'kept' || operation.state === 'rejected') learnPreference(session, item, operation.state === 'kept')
    if (item.kind === 'video' && operation.state === 'rejected') {
      item.videoSegments.forEach((segment) => { segment.state = 'rejected'; segment.decisionSource = 'user' })
    }
    return
  }
  if (operation.type === 'set-video-segment-state') {
    applyVideoSegmentSelection(requireItem(session.items, operation.itemId), operation.segmentId, operation.state)
    return
  }
  if (operation.type === 'set-representative') {
    const group = session.groups.find((candidate) => candidate.id === operation.groupId)
    if (!group?.itemIds.includes(operation.itemId)) throw new Error('相似组或素材不存在')
    group.representativeId = operation.itemId
    group.confirmation = 'confirmed'
    group.userModified = true
    for (const id of group.itemIds) {
      const item = requireItem(session.items, id)
      item.state = id === operation.itemId ? 'kept' : 'rejected'
      item.decisionSource = 'user'
    }
    return
  }
  if (operation.type === 'confirm-group') {
    const group = session.groups.find((candidate) => candidate.id === operation.groupId)
    if (!group) throw new Error('相似组不存在')
    acceptRecommendations(group.itemIds.map((id) => requireItem(session.items, id)))
    group.confirmation = 'confirmed'
    return
  }
  const scene = session.scenes.find((candidate) => candidate.id === operation.sceneId)
  if (!scene) throw new Error('场景不存在')
  if (operation.type === 'confirm-scene') {
    acceptRecommendations(scene.itemIds.map((id) => requireItem(session.items, id)))
    scene.confirmation = 'confirmed'
    session.groups.filter((group) => group.sceneId === scene.id).forEach((group) => { group.confirmation = 'confirmed' })
  } else if (operation.type === 'reopen-scene') {
    scene.confirmation = 'reopened'
  }
}
