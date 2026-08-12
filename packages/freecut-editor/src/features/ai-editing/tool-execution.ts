import { useProjectStore } from '@freecut/features/projects/stores/project-store'
import { useTimelineCommandStore } from '@freecut/features/timeline/stores/timeline-command-store'
import { useTimelineStore } from '@freecut/features/timeline/stores/timeline-store-facade'
import type { EmbeddedAiAssistantToolCall } from '@freecut/shared/host/embedded-host'
import type { AiEditingRunOptions } from './run-types'
import { getAiEditingTool } from './tool-registry'
import type {
  AiEditingObservation,
  AiEditingToolCall,
  AiEditingToolResult,
} from './types'

const MAX_TOOL_RESULT_CHARS = 8_000

function toolError(toolId: string, message: string): AiEditingObservation {
  return { toolId, result: { ok: false, message } }
}

function structuredToolError(error: unknown): AiEditingToolResult {
  const message = error instanceof Error ? error.message : '操作未能完成。'
  const code = message.match(/\b(SOURCE_[A-Z_]+)\b/)?.[1] ?? 'TOOL_EXECUTION_FAILED'
  return {
    ok: false,
    message,
    data: {
      error: {
        code,
        retryable: code === 'SOURCE_REVISION_MISMATCH',
      },
    },
  }
}

export function serializeForModel(value: unknown): string {
  const text = JSON.stringify(value)
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…` : text
}

export function serializeToolResultsForModel(observations: readonly AiEditingObservation[]): string {
  return serializeForModel(observations.map((observation) => ({
    id: observation.toolId,
    result: observation.result,
  })))
}

async function saveTimelineAfterEdit(): Promise<void> {
  const timeline = useTimelineStore.getState()
  if (!timeline.isDirty) return
  const projectId = useProjectStore.getState().currentProject?.id
  if (!projectId) throw new Error('当前项目不可用，无法保存剪辑结果。')
  await timeline.saveTimeline(projectId)
}

function persistsProjectSource(toolId: string): boolean {
  return toolId.startsWith('source.') || toolId.startsWith('git.')
}

export async function executeToolCall(
  call: AiEditingToolCall,
  callIndex: number,
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): Promise<AiEditingObservation> {
  if (availableToolIds && !availableToolIds.has(call.id)) {
    return toolError(call.id, '这个工具不在当前可用范围内，请从系统提供的工具中选择。')
  }
  const tool = getAiEditingTool(call.id)
  if (!tool) return toolError(call.id, '这个操作目前不可用。')

  const validation = tool.validate(call.args)
  if (!validation.ok) {
    return {
      toolId: tool.id,
      result: {
        ok: false,
        message: validation.error,
        ...(validation.details ? { data: { validationIssues: validation.details } } : {}),
      },
    }
  }

  const activityId = `${options.activityScope ?? 'turn'}-${callIndex}-${tool.id}`
  const tracksProgress = tool.execution === 'async' || tool.risk === 'analysis'
  options.onToolActivity?.({
    id: activityId,
    toolId: tool.id,
    title: tool.title,
    status: 'running',
    ...(tracksProgress ? { progressLabel: `正在${tool.title}`, progressPercent: null } : {}),
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))

  const reportProgress = (progress: { label: string; percent: number | null }): void => {
    const percent = progress.percent === null
      ? null
      : Math.max(0, Math.min(100, Math.round(progress.percent)))
    options.onToolActivity?.({
      id: activityId,
      toolId: tool.id,
      title: tool.title,
      status: 'running',
      progressLabel: progress.label,
      progressPercent: percent,
    })
  }

  let result: AiEditingToolResult
  try {
    if (tool.risk === 'edit' && tool.execution === 'sync') {
      result = useTimelineCommandStore.getState().executeTransaction(
        { type: 'AI_EDITING_TOOL', payload: { toolId: tool.id } },
        () => {
          const execution = tool.execute(validation.value, {
            signal: options.signal,
            reportProgress,
          })
          if (execution instanceof Promise) throw new Error('剪辑操作未能及时完成。')
          return execution
        },
      )
    } else {
      result = await tool.execute(validation.value, {
        signal: options.signal,
        reportProgress,
      })
    }
    if (result.ok && tool.risk === 'edit' && !persistsProjectSource(tool.id)) {
      await saveTimelineAfterEdit()
    }
  } catch (error) {
    result = structuredToolError(error)
  }

  options.onToolActivity?.({
    id: activityId,
    toolId: tool.id,
    title: tool.title,
    status: result.ok ? 'succeeded' : 'failed',
    message: result.message,
    ...(tracksProgress && result.ok
      ? { progressLabel: `${tool.title}已完成`, progressPercent: 100 }
      : {}),
  })
  return { toolId: tool.id, result }
}

export async function executeNativeToolCall(
  call: EmbeddedAiAssistantToolCall,
  toolIdsByFunctionName: Map<string, string>,
  callIndex: number,
  options: AiEditingRunOptions,
  availableToolIds?: ReadonlySet<string>,
): Promise<AiEditingObservation> {
  const toolId = toolIdsByFunctionName.get(call.name)
  if (!toolId) return toolError(call.name, '这个操作目前不可用。')
  let args: Record<string, unknown>
  try {
    const value = JSON.parse(call.arguments) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    args = value as Record<string, unknown>
  } catch {
    return toolError(toolId, '操作参数无效，未执行此操作。')
  }
  return executeToolCall({ id: toolId, args }, callIndex, options, availableToolIds)
}
