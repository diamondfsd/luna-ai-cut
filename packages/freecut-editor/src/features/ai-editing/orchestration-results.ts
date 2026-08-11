import type { AiEditingObservation } from './types'

export const EDIT_COMMIT_TOOL_ID = 'git.commit'

function isSuccessfulCommit(observation: AiEditingObservation): boolean {
  if (!observation.result.ok) return false
  const data = observation.result.data
  return Boolean(data && typeof data === 'object' && (data as { created?: unknown }).created === true)
}

export function hasCommittedEdit(observations: readonly AiEditingObservation[]): boolean {
  return observations.some((observation) => {
    return observation.toolId === EDIT_COMMIT_TOOL_ID && isSuccessfulCommit(observation)
  })
}

export function hasSourceChanges(observations: readonly AiEditingObservation[]): boolean {
  return observations.some((observation) =>
    observation.result.ok && (
      observation.toolId === 'source.replace' ||
      observation.toolId === 'source.create' ||
      observation.toolId === 'source.remove'
    ),
  )
}

export function hasUncommittedSourceWork(observations: readonly AiEditingObservation[]): boolean {
  if (hasCommittedEdit(observations)) return false
  let unpublished = false
  for (const observation of observations) {
    if (!observation.result.ok) continue
    const data = observation.result.data
    if (
      observation.toolId === 'source.replace' ||
      observation.toolId === 'source.create' ||
      observation.toolId === 'source.remove'
    ) {
      if (!data || typeof data !== 'object' || (data as { changed?: unknown }).changed !== false) {
        unpublished = true
      }
    }
    if (observation.toolId === 'git.commit') {
      unpublished = !isSuccessfulCommit(observation)
    }
  }
  return unpublished
}

export function defaultReply(observations: readonly AiEditingObservation[]): string {
  if (hasCommittedEdit(observations)) return '剪辑工程已更新并保存。'
  if (hasUncommittedSourceWork(observations)) return '剪辑工程已更新，但源码尚未提交。'
  return observations.length > 0 ? '已完成项目检查。' : '尚未执行项目操作。'
}

export function declaredPlan(observations: readonly AiEditingObservation[]): string[] {
  const result = observations.findLast((entry) => entry.toolId === 'workflow.set_plan')?.result.data
  if (
    !result ||
    typeof result !== 'object' ||
    !('steps' in result) ||
    !Array.isArray(result.steps)
  ) {
    return []
  }
  return result.steps.filter((step): step is string => typeof step === 'string')
}
