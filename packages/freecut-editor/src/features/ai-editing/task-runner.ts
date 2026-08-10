import type { AiEditingObservation, AiEditingTask, AiEditingTaskActivity } from './types'

export interface AiEditingTaskResult {
  reply: string
  observations: AiEditingObservation[]
  completed: boolean
  completionNotes: string[]
}

interface SequentialTaskOptions {
  signal?: AbortSignal
  onTaskActivity?: (activity: AiEditingTaskActivity) => void
  runTask(task: AiEditingTask, index: number, summaries: string[]): Promise<AiEditingTaskResult>
}

export interface SequentialTaskResult extends AiEditingTaskResult {
  plan: string[]
}

export async function runSequentialAiEditingTasks(
  tasks: AiEditingTask[],
  options: SequentialTaskOptions,
): Promise<SequentialTaskResult> {
  const observations: AiEditingObservation[] = []
  const summaries: string[] = []
  const total = tasks.length
  for (const [index, task] of tasks.entries()) {
    options.onTaskActivity?.({ ...task, index, total, status: 'pending' })
  }

  for (const [index, task] of tasks.entries()) {
    if (options.signal?.aborted) break
    options.onTaskActivity?.({ ...task, index, total, status: 'running' })
    let result: AiEditingTaskResult
    try {
      result = await options.runTask(task, index, summaries)
    } catch (error) {
      const message = error instanceof Error ? error.message : '这一步暂时无法完成。'
      options.onTaskActivity?.({ ...task, index, total, status: 'failed', message })
      return {
        reply: `“${task.title}”尚未完成：${message}`,
        observations,
        plan: tasks.map((entry) => entry.title),
        completed: false,
        completionNotes: [message],
      }
    }
    observations.push(...result.observations)
    const summary = result.reply.trim().slice(0, 240)
    if (result.completed) {
      if (summary) summaries.push(`${task.title}：${summary}`)
      options.onTaskActivity?.({
        ...task,
        index,
        total,
        status: 'succeeded',
        ...(summary ? { message: summary } : {}),
      })
      continue
    }
    const message = result.completionNotes[0] || '这一步尚未完成。'
    options.onTaskActivity?.({ ...task, index, total, status: 'failed', message })
    return {
      reply: `“${task.title}”尚未完成：${message}`,
      observations,
      plan: tasks.map((entry) => entry.title),
      completed: false,
      completionNotes: [message],
    }
  }

  if (options.signal?.aborted) {
    return {
      reply: '已停止本次剪辑，已完成的步骤会保留。',
      observations,
      plan: tasks.map((entry) => entry.title),
      completed: false,
      completionNotes: ['用户停止了本次剪辑。'],
    }
  }
  return {
    reply: summaries.at(-1)?.replace(/^.*?：/, '') || '所有剪辑步骤都已完成。',
    observations,
    plan: tasks.map((entry) => entry.title),
    completed: true,
    completionNotes: [],
  }
}
