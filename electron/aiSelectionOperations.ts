import type { AiSelectionItem, AiSelectionSession, AiSelectionUserOperation, AiShootingEvent } from '../src/shared/types'
import { applySelectionPlan, applyVideoSegmentSelection } from './aiSelectionAlgorithms'

export type AiSelectionSnapshot = Pick<AiSelectionSession, 'mode' | 'purpose' | 'workflow' | 'items' | 'events' | 'similarityGroups'>

export function createAiSelectionSnapshot(session: AiSelectionSnapshot): AiSelectionSnapshot {
  return structuredClone({ mode: session.mode, purpose: session.purpose, workflow: session.workflow, items: session.items, events: session.events, similarityGroups: session.similarityGroups })
}

export function applyAiSelectionUserOperation(session: AiSelectionSnapshot, operation: AiSelectionUserOperation): void {
  if (operation.type === 'set-density') {
    session.mode = operation.mode
    applySelectionPlan(session.items, session.similarityGroups, session.mode, session.purpose, session.workflow)
  } else if (operation.type === 'set-purpose') {
    session.purpose = operation.purpose
    applySelectionPlan(session.items, session.similarityGroups, session.mode, session.purpose, session.workflow)
  } else if (operation.type === 'set-workflow') {
    session.workflow = operation.workflow
    applySelectionPlan(session.items, session.similarityGroups, session.mode, session.purpose, session.workflow)
  } else if (operation.type === 'set-selected') {
    const item = session.items.find((candidate) => candidate.id === operation.itemId)
    if (!item) throw new Error('素材不存在')
    item.selected = operation.selected
    item.selectionSource = 'user'
    if (!operation.selected) item.videoSegments.forEach((segment) => { segment.selected = false })
  } else if (operation.type === 'set-video-segment') {
    const item = session.items.find((candidate) => candidate.id === operation.itemId)
    if (!item) throw new Error('视频片段不存在')
    applyVideoSegmentSelection(item, operation.segmentId, operation.selected)
  } else if (operation.type === 'set-representative') {
    const group = session.similarityGroups.find((candidate) => candidate.id === operation.groupId)
    if (!group?.itemIds.includes(operation.itemId)) throw new Error('相似组或素材不存在')
    group.representativeId = operation.itemId
    group.userModified = true
    for (const id of group.itemIds) {
      const item = session.items.find((candidate) => candidate.id === id)
      if (!item) continue
      item.selected = id === operation.itemId
      item.selectionSource = 'user'
    }
  } else if (operation.type === 'rename-event') {
    const event = session.events.find((candidate) => candidate.id === operation.eventId)
    if (!event) throw new Error('拍摄事件不存在')
    event.name = operation.name.trim() || event.name
    event.userModified = true
  } else if (operation.type === 'merge-events') {
    const targets = session.events.filter((event) => operation.eventIds.includes(event.id))
    if (targets.length < 2) throw new Error('请选择至少两个拍摄事件')
    const merged = targets.sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0]
    merged.itemIds = [...new Set(targets.flatMap((event) => event.itemIds))]
    merged.endAt = targets.reduce((latest, event) => Date.parse(event.endAt) > Date.parse(latest) ? event.endAt : latest, merged.endAt)
    merged.userModified = true
    session.events = session.events.filter((event) => event === merged || !operation.eventIds.includes(event.id))
    merged.itemIds.forEach((id) => { const item = session.items.find((candidate) => candidate.id === id); if (item) item.eventId = merged.id })
  } else if (operation.type === 'split-event') {
    const event = session.events.find((candidate) => candidate.id === operation.eventId)
    const index = event?.itemIds.indexOf(operation.beforeItemId) ?? -1
    if (!event || index <= 0) throw new Error('拆分位置无效')
    const secondIds = event.itemIds.splice(index)
    const secondItems = secondIds.map((id) => session.items.find((item) => item.id === id)).filter((item): item is AiSelectionItem => Boolean(item))
    const second: AiShootingEvent = { id: `${event.id}_split_${Date.now()}`, name: `${event.name} 2`, startAt: secondItems[0].capturedAt, endAt: secondItems[secondItems.length - 1].capturedAt, itemIds: secondIds, userModified: true }
    event.endAt = session.items.find((item) => item.id === event.itemIds[event.itemIds.length - 1])?.capturedAt ?? event.endAt
    event.userModified = true
    session.events.splice(session.events.indexOf(event) + 1, 0, second)
    secondIds.forEach((id) => { const item = session.items.find((candidate) => candidate.id === id); if (item) item.eventId = second.id })
  } else if (operation.type === 'remove-from-group') {
    const group = session.similarityGroups.find((candidate) => candidate.id === operation.groupId)
    if (!group) throw new Error('相似组不存在')
    group.itemIds = group.itemIds.filter((id) => id !== operation.itemId)
    group.userModified = true
    const item = session.items.find((candidate) => candidate.id === operation.itemId)
    if (item) item.similarityGroupId = null
    if (group.representativeId === operation.itemId) group.representativeId = group.itemIds[0] ?? ''
    if (group.itemIds.length < 2) session.similarityGroups = session.similarityGroups.filter((candidate) => candidate.id !== group.id)
  }
}
