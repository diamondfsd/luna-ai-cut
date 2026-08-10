import { getTimelineRevision } from './evidence'
import { latestFailedEdit } from './latest-edit-result'
import {
  getAiEditingAdapter,
  runSingleAiEditingTurn,
} from './orchestrator'
import type { AiEditingRunOptions, AiEditingRunResult } from './run-types'
import {
  buildAiEditingTaskInstruction,
  planAiEditingTasks,
  scopeWorkspaceForTask,
  shouldUseAiEditingTaskMode,
} from './task-planner'
import { runSequentialAiEditingTasks } from './task-runner'
import { buildAgentWorkspaceDocument } from './workspace-document/build-workspace-document'

const MAX_TASK_TOOL_ROUNDS = 3

export { getAiEditingAdapter }
export type { AiEditingRunOptions, AiEditingRunResult } from './run-types'

export async function runAiEditingTurn(
  userText: string,
  options: AiEditingRunOptions,
): Promise<AiEditingRunResult> {
  const adapter = options.adapter ?? getAiEditingAdapter()
  const initialWorkspace = await buildAgentWorkspaceDocument()
  if (!shouldUseAiEditingTaskMode(userText, initialWorkspace)) {
    return runSingleAiEditingTurn(userText, options, { evidence: initialWorkspace })
  }

  const timelineRevisionBefore = getTimelineRevision()
  options.onRunProgress?.({ label: '正在把目标拆成可执行步骤', percent: 22, ceiling: 48 })
  const tasks = await planAiEditingTasks(userText, options.history, initialWorkspace, adapter, {
    signal: options.signal,
    onToken: options.onToken,
  })
  options.onRunProgress?.({ label: `已规划 ${tasks.length} 个步骤`, percent: 50, ceiling: 55 })

  const result = await runSequentialAiEditingTasks(tasks, {
    signal: options.signal,
    onTaskActivity: options.onTaskActivity,
    runTask: async (task, index, summaries) => {
      const currentWorkspace = await buildAgentWorkspaceDocument()
      const progressStart = 52 + (index / tasks.length) * 42
      const progressSpan = 42 / tasks.length
      const taskInstruction = buildAiEditingTaskInstruction(
        userText,
        task,
        index,
        tasks.length,
        summaries,
      )
      options.onRunProgress?.({
        label: `正在执行第 ${index + 1}/${tasks.length} 步：${task.title}`,
        percent: Math.round(52 + (index / tasks.length) * 42),
        ceiling: Math.round(56 + ((index + 1) / tasks.length) * 38),
      })
      return runSingleAiEditingTurn(
        taskInstruction,
        {
          ...options,
          history: [],
          activityScope: task.id,
          scopeWorkspace: (workspace) => scopeWorkspaceForTask(workspace, task),
          onRunProgress: (progress) => options.onRunProgress?.({
            ...progress,
            label: `第 ${index + 1}/${tasks.length} 步：${progress.label}`,
            percent: Math.round(progressStart + (progress.percent / 100) * progressSpan),
            ...(progress.ceiling === undefined
              ? {}
              : { ceiling: Math.round(progressStart + (progress.ceiling / 100) * progressSpan) }),
          }),
        },
        {
          evidence: scopeWorkspaceForTask(currentWorkspace, task),
          maxToolRounds: MAX_TASK_TOOL_ROUNDS,
        },
      )
    },
  })
  const failedEdit = latestFailedEdit(result.observations)
  return {
    ...result,
    ...(failedEdit ? { reply: `剪辑步骤没有提交：${failedEdit.result.message}` } : {}),
    completed: !failedEdit && result.completed,
    completionNotes: failedEdit ? [failedEdit.result.message] : result.completionNotes,
    timelineRevisionBefore,
    timelineRevisionAfter: getTimelineRevision(),
  }
}
