import type { TimelineItem } from '@freecut/types/timeline'
import type { EditProgram } from './types'

export function assertNoSourceCollisions(items: TimelineItem[], touchedIds: Set<string>): void {
  const sorted = items.toSorted(
    (left, right) => left.trackId.localeCompare(right.trackId) || left.from - right.from,
  )
  for (let index = 1; index < sorted.length; index += 1) {
    const left = sorted[index - 1]!
    const right = sorted[index]!
    if (left.trackId !== right.trackId) continue
    if (left.from + left.durationInFrames <= right.from) continue
    if (!touchedIds.has(left.id) && !touchedIds.has(right.id)) continue
    throw new Error(`片段“${left.label}”与“${right.label}”在同一轨道发生重叠。`)
  }
}

export function collectDesiredSourceRefs(program: EditProgram): Set<string> {
  const refs = new Set<string>()
  if (!program.sourceProjectId) return refs

  for (const operation of program.operations) {
    const drafts =
      operation.type === 'replaceRange'
        ? operation.clips
        : operation.type === 'insertClip'
          ? [operation.clip]
          : operation.type === 'insertText'
            ? [operation.text]
            : operation.type === 'insertHtml'
              ? [operation.html]
              : []
    for (const draft of drafts) {
      if (refs.has(draft.ref)) {
        throw new Error(`剪辑源码中的片段引用“${draft.ref}”重复。`)
      }
      refs.add(draft.ref)
    }
  }
  return refs
}

export function indexOwnedSourceRefs(
  program: EditProgram,
  items: readonly TimelineItem[],
  refs: Map<string, string>,
): void {
  if (!program.sourceProjectId) return
  for (const item of items) {
    if (
      item.aiEditingSource?.projectId === program.sourceProjectId &&
      item.aiEditingSource.role === 'primary'
    ) {
      refs.set(item.aiEditingSource.ref, item.id)
    }
  }
}

export function removeOwnedSourceRef(input: {
  program: EditProgram
  sourceRef: string
  items: readonly TimelineItem[]
  markRemoved: (item: TimelineItem) => void
}): { items: TimelineItem[]; removed: boolean } {
  if (!input.program.sourceProjectId) return { items: [...input.items], removed: false }
  const owned = input.items.filter(
    (item) =>
      item.aiEditingSource?.projectId === input.program.sourceProjectId &&
      item.aiEditingSource?.ref === input.sourceRef,
  )
  if (owned.length === 0) return { items: [...input.items], removed: false }
  for (const item of owned) input.markRemoved(item)
  const ownedIds = new Set(owned.map((item) => item.id))
  return {
    items: input.items.filter((item) => !ownedIds.has(item.id)),
    removed: true,
  }
}

export function sourceOwnedItems(
  program: EditProgram,
  items: readonly TimelineItem[],
): TimelineItem[] {
  if (!program.sourceProjectId) return []
  return items.filter(
    (item) =>
      item.aiEditingSource?.projectId === program.sourceProjectId &&
      item.aiEditingSource?.role === 'primary',
  )
}

export function tagSourceOwnedItems(
  program: EditProgram,
  sourceRef: string,
  items: TimelineItem[],
): void {
  if (!program.sourceProjectId) return
  items.forEach((item, index) => {
    item.aiEditingSource = {
      projectId: program.sourceProjectId!,
      ref: sourceRef,
      role: index === 0 ? 'primary' : 'linked',
    }
  })
}
