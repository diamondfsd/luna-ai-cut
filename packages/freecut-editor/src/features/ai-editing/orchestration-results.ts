import type { AiEditingObservation } from './types'

export const TIMELINE_COMMIT_TOOL_ID = 'timeline.commit'
export const TIMELINE_STAGE_PUBLISH_TOOL_ID = 'timeline.publish_stage'

function isSuccessfulPublication(observation: AiEditingObservation): boolean {
  if (!observation.result.ok) return false
  const data = observation.result.data
  return Boolean(data && typeof data === 'object' && (data as { ok?: unknown }).ok === true)
}

export function hasCommittedEdit(observations: readonly AiEditingObservation[]): boolean {
  return observations.some((observation) => {
    return observation.toolId === TIMELINE_COMMIT_TOOL_ID && isSuccessfulPublication(observation)
  })
}

export function hasUnpublishedSourceWork(observations: readonly AiEditingObservation[]): boolean {
  if (hasCommittedEdit(observations)) return false
  let unpublished = false
  for (const observation of observations) {
    if (
      observation.toolId === TIMELINE_STAGE_PUBLISH_TOOL_ID &&
      isSuccessfulPublication(observation)
    ) {
      unpublished = false
      continue
    }
    if (!observation.result.ok) continue
    const data = observation.result.data
    if (observation.toolId === 'workspace.patch') {
      if (!data || typeof data !== 'object' || (data as { changed?: unknown }).changed !== false) {
        unpublished = true
      }
    }
    if (observation.toolId === 'git.commit') {
      if (!data || typeof data !== 'object' || (data as { created?: unknown }).created !== false) {
        unpublished = true
      }
    }
  }
  return unpublished
}

export function hasUnfinalizedEdit(observations: readonly AiEditingObservation[]): boolean {
  if (hasCommittedEdit(observations)) return false
  return observations.some(
    (observation) =>
      observation.toolId === TIMELINE_STAGE_PUBLISH_TOOL_ID &&
      isSuccessfulPublication(observation),
  )
}

export function defaultReply(observations: readonly AiEditingObservation[]): string {
  if (hasCommittedEdit(observations)) return '剪辑工程已构建并发布到时间轴。'
  if (hasUnpublishedSourceWork(observations)) return '剪辑源码尚未发布到时间轴。'
  if (hasUnfinalizedEdit(observations)) return '当前阶段已发布，剪辑工程尚未最终提交。'
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
