import type { AiEditingObservation } from './types'

export const FINISH_TOOL_ID = 'workflow.finish'
export const EDIT_PROGRAM_TOOL_ID = 'workspace.apply_edit_program'

interface FinishData {
  outcome: 'responded' | 'edited' | 'blocked'
  summary: string
  remainingWork?: string
}

export interface TerminalState {
  finished: boolean
  completed: boolean
  outcome?: FinishData['outcome']
  reply?: string
  completionNotes: string[]
}

function finishData(observation: AiEditingObservation): FinishData | null {
  const data = observation.result.data
  if (!observation.result.ok || !data || typeof data !== 'object') return null
  const candidate = data as Partial<FinishData>
  if (
    candidate.outcome !== 'responded' &&
    candidate.outcome !== 'edited' &&
    candidate.outcome !== 'blocked'
  ) return null
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) return null
  return {
    outcome: candidate.outcome,
    summary: candidate.summary,
    ...(typeof candidate.remainingWork === 'string' && candidate.remainingWork.trim()
      ? { remainingWork: candidate.remainingWork }
      : {}),
  }
}

export function hasCommittedEdit(observations: readonly AiEditingObservation[]): boolean {
  return observations.some((observation) => {
    if (observation.toolId !== EDIT_PROGRAM_TOOL_ID || !observation.result.ok) return false
    const data = observation.result.data
    return Boolean(data && typeof data === 'object' && (data as { committed?: unknown }).committed === true)
  })
}

export function validateFinishObservation(
  observation: AiEditingObservation,
  previousObservations: readonly AiEditingObservation[],
): AiEditingObservation {
  if (observation.toolId !== FINISH_TOOL_ID || !observation.result.ok) return observation
  const data = finishData(observation)
  if (!data) return { toolId: FINISH_TOOL_ID, result: { ok: false, message: '结束状态无效。' } }
  if (data.outcome === 'edited' && !hasCommittedEdit(previousObservations)) {
    return {
      toolId: FINISH_TOOL_ID,
      result: { ok: false, message: '尚未成功提交任何时间轴修改，不能声明剪辑完成。' },
    }
  }
  return observation
}

export function terminalState(observations: readonly AiEditingObservation[]): TerminalState {
  const finish = observations.findLast((entry) => entry.toolId === FINISH_TOOL_ID)
  if (!finish) return { finished: false, completed: false, completionNotes: [] }
  const data = finishData(finish)
  if (!data) return { finished: false, completed: false, completionNotes: [] }
  if (data.outcome === 'blocked') {
    return {
      finished: true,
      completed: false,
      outcome: data.outcome,
      reply: data.summary,
      completionNotes: [data.remainingWork ?? data.summary],
    }
  }
  return {
    finished: true,
    completed: true,
    outcome: data.outcome,
    reply: data.summary,
    completionNotes: [],
  }
}

export function defaultReply(observations: readonly AiEditingObservation[]): string {
  if (hasCommittedEdit(observations)) return '已保存当前完成的时间轴修改。'
  return observations.length > 0 ? '已读取当前项目，但还没有完成实际修改。' : '尚未执行项目操作。'
}

export function declaredPlan(observations: readonly AiEditingObservation[]): string[] {
  const result = observations.findLast((entry) => entry.toolId === 'workflow.set_plan')?.result.data
  if (!result || typeof result !== 'object' || !('steps' in result) || !Array.isArray(result.steps)) return []
  return result.steps.filter((step): step is string => typeof step === 'string')
}
