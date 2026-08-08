import { useTimelineCommandStore, useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { compileEditProgram } from './compiler'
import { buildAgentWorkspaceDocument } from '../workspace-document/build-workspace-document'
import type { EditProgram, EditProgramApplyResult } from './types'

export async function applyEditProgram(program: EditProgram): Promise<EditProgramApplyResult> {
  const compiled = await compileEditProgram(program)
  const revisionBefore = useTimelineStore.getState().changeVersion ?? 0
  if (program.mode === 'preview') {
    return {
      committed: false,
      revisionBefore,
      revisionAfter: revisionBefore,
      diff: compiled.diff,
      warnings: compiled.warnings,
      workspace: await buildAgentWorkspaceDocument(),
    }
  }

  useTimelineCommandStore.getState().executeTransaction(
    { type: 'AI_EDIT_PROGRAM', payload: { intent: program.intent } },
    () => {
      if ((useTimelineStore.getState().changeVersion ?? 0) !== program.baseRevision) {
        throw new Error('时间轴在编辑程序提交前已发生变化，本次修改没有执行。')
      }
      const timeline = useTimelineStore.getState()
      if (compiled.removeIds.length > 0) timeline.removeItems(compiled.removeIds)
      if (compiled.insertItems.length > 0) {
        for (const item of compiled.insertItems) timeline.addItem(item)
      }
      for (const update of compiled.updates) timeline.updateItem(update.id, update.updates)

      for (const change of compiled.transitions) {
        const current = useTimelineStore.getState()
        const existing = current.transitions.find(
          (transition) =>
            transition.leftClipId === change.between[0] &&
            transition.rightClipId === change.between[1],
        )
        if (existing) current.removeTransition(existing.id)
        if (!change.draft) continue
        const added = useTimelineStore.getState().addTransition(
          change.between[0],
          change.between[1],
          'crossfade',
          Math.max(1, Math.round(change.draft.duration * current.fps)),
          change.draft.presentation,
          change.draft.direction,
          change.draft.alignment ?? 0.5,
        )
        if (!added) throw new Error('转场不符合相邻关系或素材余量要求，本次修改已回滚。')
      }
    },
  )

  const revisionAfter = useTimelineStore.getState().changeVersion ?? revisionBefore
  return {
    committed: true,
    revisionBefore,
    revisionAfter,
    diff: compiled.diff,
    warnings: compiled.warnings,
    workspace: await buildAgentWorkspaceDocument(),
  }
}
