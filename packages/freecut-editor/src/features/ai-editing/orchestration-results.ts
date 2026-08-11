import type { AiEditingObservation } from './types'

export const TIMELINE_COMMIT_TOOL_ID = 'timeline.commit'

export function hasCommittedEdit(observations: readonly AiEditingObservation[]): boolean {
  return observations.some((observation) => {
    if (observation.toolId !== TIMELINE_COMMIT_TOOL_ID || !observation.result.ok) return false
    const data = observation.result.data
    return Boolean(data && typeof data === 'object' && (data as { ok?: unknown }).ok === true)
  })
}

export function hasUnpublishedSourceWork(observations: readonly AiEditingObservation[]): boolean {
  if (hasCommittedEdit(observations)) return false
  return observations.some((observation) => {
    if (!observation.result.ok) return false
    const data = observation.result.data
    if (observation.toolId === 'workspace.patch') {
      return !data || typeof data !== 'object' || (data as { changed?: unknown }).changed !== false
    }
    if (observation.toolId === 'git.commit') {
      return !data || typeof data !== 'object' || (data as { created?: unknown }).created !== false
    }
    return false
  })
}

export function defaultReply(observations: readonly AiEditingObservation[]): string {
  if (hasCommittedEdit(observations)) return '剪辑工程已构建并发布到时间轴。'
  if (hasUnpublishedSourceWork(observations)) return '剪辑源码尚未发布到时间轴。'
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
